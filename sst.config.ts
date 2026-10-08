/// <reference path="./.sst/platform/config.d.ts" />

/**
 * AMU Reporting: SST publishers and crons.
 * The public Next.js site is ECS (infra/lib/reporting-ecs-stack.ts), not SST.
 * Publishers write canonical sources/{source}/{dataset}/ raw only.
 * MAS/Alumni processors derive on-read (no derived S3 writes).
 */
export default $config({
  app(input) {
    return {
      name: "amu-reporting",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: ["production"].includes(input?.stage ?? ""),
      home: "aws",
      providers: { aws: { region: "us-east-2" } },
    };
  },
  async run() {
    // Keep AuthSecret and AllowedEmails declared. ECS reads Secrets Manager,
    // not these links; dropping the constructors would still be a config change
    // against retained production secrets.
    new sst.Secret("AuthSecret");
    const resendApiKey = new sst.Secret("ResendApiKey");
    // The hostname we send people. Must stay in step with APP_BASE_URL in
    // infra/lib/reporting-ecs-stack.ts. Do not add sst.aws.Nextjs("Web"): CI
    // would recreate the leftover Lambda. After #194, leftover SST state
    // parents Web (sst:aws:Nextjs) and WebLinkRef (sst:sst:LinkRef) have no
    // AWS ids. This production SST deploy should drop those parents. Live
    // CDN remains untracked E21ZFV7FXYGILQ (reporting.avemaria.edu). Do not
    // disable deletion protection or delete Dynamo
    // amu-reporting-production-WebRevalidationTable-bdsurfmw (untracked,
    // 15856 items).
    const reportingUrl = "https://reporting.avemaria.edu";
    const virtuousApiKey = new sst.Secret("VirtuousApiKey");
    const qlikApiKey = new sst.Secret("QlikApiKey");
    const qlikTenant = new sst.Secret("QlikTenant");
    const erezlifeApiKey = new sst.Secret("ErezlifeApiKey");
    const slateQueryUrl = new sst.Secret("SlateQueryUrl");
    const slateDepositsUrl = new sst.Secret("SlateDepositsUrl");
    const instituteSlateQueries = new sst.Secret("InstituteSlateQueries");
    const athleticsSlateQueries = new sst.Secret("AthleticsSlateQueries");
    const pursuitWisdomExportToken = new sst.Secret("PursuitWisdomExportToken");
    new sst.Secret("AllowedEmails");

    // PowerFAIDS and Great Plains raw pulls are isolated per source. Only that source's ECS
    // task role (infra/lib/reporting-ecs-stack.ts, isolatedSqlSources) may read, write or
    // delete under its prefix, and every write must be SSE-KMS. The break-glass user and the
    // account root may read. Everything else (web, the shared worker, these Lambdas) is denied
    // even though their IAM grants cover the whole bucket. SST merges these with the HTTPS deny.
    // Keep in sync with account / breakGlassUserArn / isolatedSqlSources in infra/lib/reporting-ecs-stack.ts.
    const account = "905418447941";
    const breakGlassReaders = [
      `arn:aws:iam::${account}:user/michael-middendorf`,
      `arn:aws:iam::${account}:root`,
    ];
    const isolatedSourcePolicy = ["powerfaids", "greatplains"].flatMap((source) => {
      const taskRole = `arn:aws:iam::${account}:role/amu-reporting-${source}-task`;
      return [
        {
          effect: "deny" as const,
          principals: "*" as const,
          actions: ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:PutObjectAcl"],
          paths: [`sources/${source}/*`],
          conditions: [{ test: "ArnNotEquals", variable: "aws:PrincipalArn", values: [taskRole] }],
        },
        {
          effect: "deny" as const,
          principals: "*" as const,
          actions: ["s3:GetObject", "s3:GetObjectVersion"],
          paths: [`sources/${source}/*`],
          conditions: [{ test: "ArnNotEquals", variable: "aws:PrincipalArn", values: [taskRole, ...breakGlassReaders] }],
        },
        {
          effect: "deny" as const,
          principals: "*" as const,
          actions: ["s3:PutObject"],
          paths: [`sources/${source}/*`],
          conditions: [{ test: "StringNotEquals", variable: "s3:x-amz-server-side-encryption", values: ["aws:kms"] }],
        },
        // Hide key names (dataset names, dates) under the prefix from everyone else too.
        {
          effect: "deny" as const,
          principals: "*" as const,
          actions: ["s3:ListBucket"],
          paths: [""],
          conditions: [
            { test: "StringLike", variable: "s3:prefix", values: [`sources/${source}/*`] },
            { test: "ArnNotEquals", variable: "aws:PrincipalArn", values: [taskRole, ...breakGlassReaders] },
          ],
        },
      ];
    });

    // Scholarship need extract (derived from PowerFAIDS, written by the PowerFAIDS task role,
    // read only by the scholarship app). Same isolated pattern as above. Keep in sync with
    // scholarshipNeedExtract in infra/lib/reporting-ecs-stack.ts.
    const scholarshipNeedWriter = `arn:aws:iam::${account}:role/amu-reporting-powerfaids-task`;
    const scholarshipNeedReader = `arn:aws:iam::${account}:role/scholarship-app-task-role`;
    const scholarshipNeedPolicy = [
      {
        effect: "deny" as const,
        principals: "*" as const,
        actions: ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:PutObjectAcl"],
        paths: ["sources/scholarship-need/*"],
        conditions: [{ test: "ArnNotEquals", variable: "aws:PrincipalArn", values: [scholarshipNeedWriter] }],
      },
      {
        effect: "deny" as const,
        principals: "*" as const,
        actions: ["s3:GetObject", "s3:GetObjectVersion"],
        paths: ["sources/scholarship-need/*"],
        conditions: [
          { test: "ArnNotEquals", variable: "aws:PrincipalArn", values: [scholarshipNeedReader, scholarshipNeedWriter, ...breakGlassReaders] },
        ],
      },
      {
        effect: "deny" as const,
        principals: "*" as const,
        actions: ["s3:PutObject"],
        paths: ["sources/scholarship-need/*"],
        conditions: [{ test: "StringNotEquals", variable: "s3:x-amz-server-side-encryption", values: ["aws:kms"] }],
      },
      {
        effect: "deny" as const,
        principals: "*" as const,
        actions: ["s3:ListBucket"],
        paths: [""],
        conditions: [
          { test: "StringLike", variable: "s3:prefix", values: ["sources/scholarship-need/*"] },
          { test: "ArnNotEquals", variable: "aws:PrincipalArn", values: [scholarshipNeedWriter, ...breakGlassReaders] },
        ],
      },
    ];

    // IT-3 Cybersecurity KPI snapshots (cybersecurity/*). Written only by the
    // SecurityPublisher role, read only by it, the ECS web task role and break-glass.
    // Every write must be SSE-KMS (alias/amu-reporting-cyber, created in
    // infra/lib/reporting-ecs-stack.ts as CyberKey). The web task role name has a
    // CDK suffix, so it is matched with ArnNotLike.
    const securityPublisherRoleName = "amu-reporting-security-publisher";
    const securityPublisherRoleArn = `arn:aws:iam::${account}:role/${securityPublisherRoleName}`;
    const cyberWebReaderPattern = `arn:aws:iam::${account}:role/AmuReportingEcs-WebTaskTaskRole*`;
    const cyberKeyArn = `arn:aws:kms:us-east-2:${account}:key/ba0b8184-c8f3-4b6e-8733-f8c9c9022bcb`;
    const cyberPrefixPolicy = [
      {
        effect: "deny" as const,
        principals: "*" as const,
        actions: ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion", "s3:PutObjectAcl"],
        paths: ["cybersecurity/*"],
        conditions: [{ test: "ArnNotEquals", variable: "aws:PrincipalArn", values: [securityPublisherRoleArn] }],
      },
      {
        effect: "deny" as const,
        principals: "*" as const,
        actions: ["s3:GetObject", "s3:GetObjectVersion"],
        paths: ["cybersecurity/*"],
        conditions: [
          { test: "ArnNotLike", variable: "aws:PrincipalArn", values: [securityPublisherRoleArn, cyberWebReaderPattern, ...breakGlassReaders] },
        ],
      },
      {
        effect: "deny" as const,
        principals: "*" as const,
        actions: ["s3:PutObject"],
        paths: ["cybersecurity/*"],
        conditions: [{ test: "StringNotEquals", variable: "s3:x-amz-server-side-encryption", values: ["aws:kms"] }],
      },
      {
        effect: "deny" as const,
        principals: "*" as const,
        actions: ["s3:ListBucket"],
        paths: [""],
        conditions: [
          { test: "StringLike", variable: "s3:prefix", values: ["cybersecurity/*"] },
          { test: "ArnNotLike", variable: "aws:PrincipalArn", values: [securityPublisherRoleArn, cyberWebReaderPattern, ...breakGlassReaders] },
        ],
      },
    ];

    const data = new sst.aws.Bucket("ReportData", { policy: [...isolatedSourcePolicy, ...scholarshipNeedPolicy, ...cyberPrefixPolicy] });

    // Magic-link nonce table lives in infra/lib/reporting-ecs-stack.ts (deployed
    // before "Deploy SST runtime"). ECS is the only web runtime that writes it.
    // SST publishers do not need the table name or ARN.

    const reportDataPerms = [
      {
        actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket", "s3:DeleteObject"],
        resources: [
          $interpolate`arn:aws:s3:::${data.name}`,
          $interpolate`arn:aws:s3:::${data.name}/*`,
        ],
      },
    ];

    const readDataPerms = [
      {
        actions: ["s3:GetObject", "s3:ListBucket"],
        resources: [
          $interpolate`arn:aws:s3:::${data.name}`,
          $interpolate`arn:aws:s3:::${data.name}/*`,
        ],
      },
    ];

    const commonFiles = [
      {
        from: "services/publishers/common",
        to: "common",
      },
    ];

    const masProcess = new sst.aws.Function("MasProcess", {
      handler: "services/publishers/mas/handler.handler",
      runtime: "python3.12",
      timeout: "15 minutes",
      memory: "3008 MB",
      link: [data],
      python: { uv: true },
      copyFiles: [
        ...commonFiles,
        {
          from: "services/publishers/mas/mas_follow_up_report",
          to: "mas_follow_up_report",
        },
      ],
      environment: {
        DATA_BUCKET: data.name,
        API_KEY: virtuousApiKey.value,
        VIRTUOUS_API_KEY: virtuousApiKey.value,
      },
      permissions: [
        ...readDataPerms,
        {
          actions: ["s3:PutObject", "s3:DeleteObject"],
          resources: [$interpolate`arn:aws:s3:::${data.name}/cache/mas/*`],
        },
      ],
    });

    const alumniProcess = new sst.aws.Function("AlumniProcess", {
      handler: "services/publishers/alumni/handler.handler",
      runtime: "python3.12",
      timeout: "15 minutes",
      memory: "3008 MB",
      link: [data],
      python: { uv: true },
      copyFiles: [
        ...commonFiles,
        {
          from: "services/publishers/alumni/virt_reporting",
          to: "virt_reporting",
        },
      ],
      environment: {
        DATA_BUCKET: data.name,
        API_KEY: virtuousApiKey.value,
        VIRTUOUS_API_KEY: virtuousApiKey.value,
      },
      permissions: readDataPerms,
    });

    // The Institute dashboard fetches its six Slate "run as service" queries
    // live on each page load (q1/q2 ~15s) via this function; the
    // /api/institute-data route invokes it synchronously and returns the built
    // payload. Data is always current with no cron / S3 cache. 60s timeout
    // leaves headroom over the ~15-25s fetch; no S3 access needed since it
    // returns the payload inline.
    const instituteData = new sst.aws.Function("InstituteData", {
      handler: "services/publishers/institute/handler.invoke_handler",
      runtime: "python3.12",
      timeout: "60 seconds",
      memory: "2048 MB",
      python: { uv: true },
      // handler.py does `import build` and `from common.sources import ...`;
      // SST only ships the handler file + deps, so the sibling build.py AND the
      // shared common/ package must be copied in explicitly (same pattern as
      // MasProcess/AlumniProcess bringing in commonFiles + their extra source).
      copyFiles: [
        ...commonFiles,
        {
          from: "services/publishers/institute/build.py",
          to: "build.py",
        },
        {
          from: "services/publishers/institute/build.py",
          to: "services/publishers/institute/build.py",
        },
      ],
      environment: {
        INSTITUTE_SLATE_QUERIES: instituteSlateQueries.value,
      },
    });

    const housingEnv = {
      DATA_BUCKET: data.name,
      QLIK_API_KEY: qlikApiKey.value,
      QLIK_TENANT: qlikTenant.value,
      EREZLIFE_API_KEY: erezlifeApiKey.value,
      API_KEY: erezlifeApiKey.value,
      SLATE_QUERY_URL: slateQueryUrl.value,
      SLATE_DEPOSITS_URL: slateDepositsUrl.value,
      SITE_URL: "https://avemaria.erezlife.com/",
      TARGET_SESSION: "2026FALL01",
      EREZ_EXTRA_SESSIONS: "2026FALL03Ireland",
      // Optional. When unset, resident names fall back to the email local-part.
      SLATE_ROSTER_URL: process.env.SLATE_ROSTER_URL || "",
    };

    const housingProcess = new sst.aws.Function("HousingProcess", {
      handler: "services/publishers/housing/handler.handler",
      runtime: "python3.12",
      timeout: "15 minutes",
      memory: "2048 MB",
      link: [data],
      python: { uv: true },
      copyFiles: [
        ...commonFiles,
        {
          from: "services/publishers/housing/housing_data.py",
          to: "housing_data.py",
        },
      ],
      environment: housingEnv,
      permissions: reportDataPerms,
    });

    const chapelNaming = new sst.aws.Function("ChapelNamingData", {
      handler: "services/publishers/chapel-naming/handler.handler",
      runtime: "python3.12",
      timeout: "2 minutes",
      memory: "1024 MB",
      link: [data],
      python: { uv: true },
      copyFiles: [
        ...commonFiles,
        {
          from: "services/publishers/chapel-naming/catalog.json",
          to: "catalog.json",
        },
      ],
      environment: {
        DATA_BUCKET: data.name,
        API_KEY: virtuousApiKey.value,
        VIRTUOUS_API_KEY: virtuousApiKey.value,
        CHAPEL_NAMING_CACHE_KEY: "chapel-naming/latest.json",
      },
      permissions: reportDataPerms,
    });

    const advancementOverview = new sst.aws.Function("AdvancementOverviewData", {
      handler: "services/publishers/advancement-overview/handler.handler",
      runtime: "python3.12",
      timeout: "15 minutes",
      memory: "2048 MB",
      // A failed cron run waits for the next 15-minute tick instead of
      // retrying, so one bad run costs one run of Virtuous calls, not three.
      retries: 0,
      link: [data],
      python: { uv: true },
      copyFiles: [
        ...commonFiles,
        {
          from: "services/publishers/advancement-overview/fund_status.csv",
          to: "fund_status.csv",
        },
      ],
      environment: {
        DATA_BUCKET: data.name,
        VIRTUOUS_API_KEY: virtuousApiKey.value,
        ADVANCEMENT_OVERVIEW_CACHE_KEY: "advancement-overview/latest.json",
        ADVANCEMENT_PIPELINE_CACHE_KEY: "advancement-overview/pipeline.json",
      },
      permissions: reportDataPerms,
    });

    const mgoTopProspects = new sst.aws.Function("MgoTopProspectsData", {
      handler: "services/publishers/mgo-top-prospects/handler.handler",
      runtime: "python3.12",
      timeout: "5 minutes",
      memory: "2048 MB",
      link: [data],
      python: { uv: true },
      copyFiles: commonFiles,
      environment: {
        DATA_BUCKET: data.name,
        API_KEY: virtuousApiKey.value,
        VIRTUOUS_API_KEY: virtuousApiKey.value,
        MGO_TOP_PROSPECTS_CACHE_KEY: "mgo-top-prospects/latest.json",
      },
      permissions: reportDataPerms,
    });

    const portfolios = new sst.aws.Function("PortfoliosData", {
      handler: "services/publishers/portfolios/handler.handler",
      runtime: "python3.12",
      timeout: "15 minutes",
      memory: "2048 MB",
      link: [data],
      python: { uv: true },
      copyFiles: commonFiles,
      environment: {
        DATA_BUCKET: data.name,
        API_KEY: virtuousApiKey.value,
        VIRTUOUS_API_KEY: virtuousApiKey.value,
        PORTFOLIOS_CACHE_KEY: "portfolios/latest.json",
      },
      permissions: reportDataPerms,
    });

    // DST-2830 MGO Analysis and Management. Fixed function name so operators can
    // invoke it by name (e.g. {"mode":"discover"}); the web route is cache-only.
    const mgoAnalysis = new sst.aws.Function("MgoAnalysisData", {
      name: `${$app.name}-${$app.stage}-MgoAnalysisData`,
      handler: "services/publishers/mgo-analysis/handler.handler",
      runtime: "python3.12",
      timeout: "15 minutes",
      memory: "2048 MB",
      // FY contact notes are the heaviest pull; a failed cron run waits for
      // the next tick instead of retrying.
      retries: 0,
      link: [data],
      python: { uv: true },
      copyFiles: commonFiles,
      environment: {
        DATA_BUCKET: data.name,
        API_KEY: virtuousApiKey.value,
        VIRTUOUS_API_KEY: virtuousApiKey.value,
        MGO_ANALYSIS_CACHE_KEY: "mgo-analysis/latest.json",
      },
      permissions: reportDataPerms,
    });

    const fallAppeal = new sst.aws.Function("FallAppealData", {
      handler: "services/publishers/fall-appeal/handler.handler",
      runtime: "python3.12",
      timeout: "15 minutes",
      memory: "1024 MB",
      link: [data],
      python: { uv: true },
      copyFiles: commonFiles,
      environment: {
        DATA_BUCKET: data.name,
        API_KEY: virtuousApiKey.value,
        VIRTUOUS_API_KEY: virtuousApiKey.value,
        FALL_APPEAL_CAMPAIGN: "2026 Fall Appeal",
        FALL_APPEAL_START: "2026-08-16",
        FALL_APPEAL_END: "2027-02-28",
        // Prior-year analog for the YoY pace comparison. Change if Advancement
        // names a different comparison set.
        FALL_APPEAL_PRIOR_CAMPAIGN: "2025 End of Calendar Year",
        FALL_APPEAL_PRIOR_START: "2025-11-01",
        FALL_APPEAL_CACHE_KEY: "appeals/fall-2026/latest.json",
        FALL_APPEAL_EMAIL_PERFORMANCE_KEY: "fall-appeal/email-performance.json",
        APPEAL_SLUG: "fall-2026",
        APPEAL_AUDIENCE_TAGS: '[{"id":93,"label":"Direct Mail Audience"}]',
      },
      permissions: reportDataPerms,
    });

    const springAppeal = new sst.aws.Function("SpringAppealData", {
      handler: "services/publishers/fall-appeal/handler.handler",
      runtime: "python3.12",
      timeout: "15 minutes",
      memory: "1024 MB",
      link: [data],
      python: { uv: true },
      copyFiles: commonFiles,
      environment: {
        DATA_BUCKET: data.name,
        API_KEY: virtuousApiKey.value,
        VIRTUOUS_API_KEY: virtuousApiKey.value,
        FALL_APPEAL_CAMPAIGN: "2026 Spring Appeal",
        FALL_APPEAL_START: "2026-03-24",
        APPEAL_ALLOW_OPEN_END: "1",
        FALL_APPEAL_CACHE_KEY: "appeals/spring-2026/latest.json",
        FALL_APPEAL_EMAIL_PERFORMANCE_KEY: "appeals/spring-2026/imports/legacy-email.json",
        APPEAL_SLUG: "spring-2026",
        APPEAL_AUDIENCE_TAGS: '[{"id":48,"label":"Brick","creative":true},{"id":47,"label":"Chapel","creative":true},{"id":49,"label":"Vocations","creative":true}]',
      },
      permissions: reportDataPerms,
    });

    const stainedGlassWindows = new sst.aws.Function("StainedGlassWindowsData", {
      handler: "services/publishers/stained-glass-windows/handler.handler",
      runtime: "python3.12",
      timeout: "2 minutes",
      memory: "1024 MB",
      link: [data],
      python: { uv: true },
      copyFiles: [
        ...commonFiles,
        {
          from: "services/publishers/stained-glass-windows/windows.json",
          to: "windows.json",
        },
      ],
      environment: {
        DATA_BUCKET: data.name,
        API_KEY: virtuousApiKey.value,
        VIRTUOUS_API_KEY: virtuousApiKey.value,
        STAINED_GLASS_WINDOWS_CACHE_KEY: "stained-glass-windows/latest.json",
      },
      permissions: reportDataPerms,
    });

    const athleticsGiving = new sst.aws.Function("AthleticsGivingData", {
      handler: "services/publishers/athletics-giving/handler.handler",
      runtime: "python3.12",
      timeout: "5 minutes",
      memory: "1024 MB",
      link: [data],
      python: { uv: true },
      copyFiles: commonFiles,
      environment: {
        DATA_BUCKET: data.name,
        API_KEY: virtuousApiKey.value,
        VIRTUOUS_API_KEY: virtuousApiKey.value,
        ATHLETICS_GIVING_CACHE_KEY: "athletics-giving/latest.json",
      },
      permissions: reportDataPerms,
    });

    const athleticsCoachingFundraising = new sst.aws.Function("AthleticsCoachingFundraisingData", {
      handler: "services/publishers/athletics-coaching-fundraising/handler.handler",
      runtime: "python3.12",
      // Normal runs take ~140s; the ~10:20 UTC run hits slow Virtuous and
      // overran 5 minutes most days. Still under the 15-minute schedule.
      timeout: "10 minutes",
      memory: "1024 MB",
      link: [data],
      python: { uv: true },
      copyFiles: [
        ...commonFiles,
        {
          from: "apps/web-next/src/lib/reports/athletics-coaching/sports.ts",
          to: "sports.ts",
        },
      ],
      environment: {
        DATA_BUCKET: data.name,
        API_KEY: virtuousApiKey.value,
        VIRTUOUS_API_KEY: virtuousApiKey.value,
        ATHLETICS_COACHING_FUNDRAISING_CACHE_KEY: "athletics-coaching-fundraising/latest.json",
      },
      permissions: reportDataPerms,
    });

    // IT-3 Cybersecurity publisher. Own named role (the bucket policy above keys on
    // its ARN), read-only AWS security APIs, writes only cybersecurity/latest.json
    // and cybersecurity/history/*. Action list: services/publishers/security/IAM.md.
    const securityPublisherRole = new aws.iam.Role("SecurityPublisherRole", {
      name: securityPublisherRoleName,
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
      }),
      managedPolicyArns: ["arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"],
    });
    new aws.iam.RolePolicy("SecurityPublisherPolicy", {
      role: securityPublisherRole.name,
      policy: $jsonStringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "ReadOnlySecurityTelemetry",
            Effect: "Allow",
            Action: [
              "securityhub:GetEnabledStandards",
              "securityhub:DescribeStandardsControls",
              "securityhub:GetFindings",
              "guardduty:ListDetectors",
              "guardduty:GetFindingsStatistics",
              "inspector2:BatchGetAccountStatus",
              "inspector2:ListFindings",
              "iam:GenerateCredentialReport",
              "iam:GetCredentialReport",
              "sts:GetCallerIdentity",
              "cloudtrail:DescribeTrails",
              "cloudtrail:GetTrailStatus",
              "backup:ListBackupJobs",
              "rds:DescribeDBInstances",
              "acm:ListCertificates",
              "acm:DescribeCertificate",
              "ec2:DescribeVpnConnections",
            ],
            Resource: "*",
          },
          {
            Sid: "ListCyberPrefix",
            Effect: "Allow",
            Action: "s3:ListBucket",
            Resource: $interpolate`arn:aws:s3:::${data.name}`,
            Condition: { StringLike: { "s3:prefix": ["cybersecurity/*"] } },
          },
          {
            Sid: "ReadCyberInputs",
            Effect: "Allow",
            Action: "s3:GetObject",
            Resource: [
              $interpolate`arn:aws:s3:::${data.name}/cybersecurity/inbox/ad/*`,
              $interpolate`arn:aws:s3:::${data.name}/cybersecurity/history/*`,
              $interpolate`arn:aws:s3:::${data.name}/cybersecurity/latest.json`,
            ],
          },
          {
            Sid: "WriteCyberSnapshots",
            Effect: "Allow",
            Action: "s3:PutObject",
            Resource: [
              $interpolate`arn:aws:s3:::${data.name}/cybersecurity/latest.json`,
              $interpolate`arn:aws:s3:::${data.name}/cybersecurity/history/*`,
            ],
          },
          {
            Sid: "CyberKeyViaS3",
            Effect: "Allow",
            Action: ["kms:GenerateDataKey", "kms:Decrypt"],
            Resource: cyberKeyArn,
            Condition: { StringEquals: { "kms:ViaService": "s3.us-east-2.amazonaws.com" } },
          },
          {
            Sid: "SecurityAppSecrets",
            Effect: "Allow",
            Action: "secretsmanager:GetSecretValue",
            Resource: [
              `arn:aws:secretsmanager:us-east-2:${account}:secret:amu-reporting/production/security-github-app-*`,
              `arn:aws:secretsmanager:us-east-2:${account}:secret:amu-reporting/production/security-graph-*`,
            ],
          },
        ],
      }),
    });

    new sst.aws.Cron("SecurityRefresh", {
      // 10:00 UTC daily (05:00 EST / 06:00 EDT).
      schedule: "cron(0 10 * * ? *)",
      function: {
        name: `${$app.name}-${$app.stage}-SecurityRefresh`,
        handler: "services/publishers/security/handler.handler",
        runtime: "python3.12",
        timeout: "10 minutes",
        memory: "512 MB",
        retries: 0,
        role: securityPublisherRole.arn,
        python: { uv: true },
        // Sibling modules go to the bundle root (same as housing_data.py above).
        copyFiles: [
          ...commonFiles,
          ...["ad", "aws", "compose", "github", "graph", "guard"].map((m) => ({
            from: `services/publishers/security/${m}.py`,
            to: `${m}.py`,
          })),
        ],
        environment: {
          DATA_BUCKET: data.name,
          CYBER_KMS_KEY_ID: cyberKeyArn,
        },
      },
    });

    new sst.aws.Cron("EnrollmentRefresh", {
      schedule: "rate(15 minutes)",
      function: {
        handler: "services/publishers/enrollment/handler.handler",
        runtime: "python3.12",
        timeout: "15 minutes",
        memory: "3008 MB",
        link: [data],
        python: { uv: true },
        copyFiles: [
          ...commonFiles,
          {
            from: "services/publishers/enrollment/query_links.json",
            to: "query_links.json",
          },
        ],
        environment: {
          DATA_BUCKET: data.name,
          QUERY_LINKS_FILE: "/var/task/query_links.json",
        },
        permissions: reportDataPerms,
      },
    });

    // AthleticsSlateQueries JSON: applications + prospects required; roster and
    // association_history optional (queries[].name=roster / association_history).
    // A missing optional entry skips that dataset.
    new sst.aws.Cron("AthleticsRefresh", {
      schedule: "rate(1 hour)",
      function: {
        handler: "services/publishers/athletics/handler.handler",
        runtime: "python3.12",
        timeout: "15 minutes",
        memory: "2048 MB",
        link: [data],
        python: { uv: true },
        copyFiles: commonFiles,
        environment: {
          DATA_BUCKET: data.name,
          ATHLETICS_SLATE_QUERIES: athleticsSlateQueries.value,
        },
        permissions: reportDataPerms,
      },
    });

    new sst.aws.Cron("VirtuousRawRefresh", {
      schedule: "rate(15 minutes)",
      function: {
        handler: "services/publishers/virtuous/handler.handler",
        runtime: "python3.12",
        timeout: "15 minutes",
        memory: "2048 MB",
        link: [data],
        python: { uv: true },
        copyFiles: commonFiles,
        environment: {
          DATA_BUCKET: data.name,
          API_KEY: virtuousApiKey.value,
          VIRTUOUS_API_KEY: virtuousApiKey.value,
          MAS_PROCESS_FUNCTION: masProcess.name,
        },
        permissions: [
          ...reportDataPerms,
          {
            actions: ["lambda:InvokeFunction"],
            resources: [masProcess.arn],
          },
        ],
      },
    });

    new sst.aws.Cron("HousingRefresh", {
      schedule: "rate(6 hours)",
      function: housingProcess,
    });

    // Institute data is now fetched live per page load by the InstituteData
    // function (defined above), not published on a cron — so no InstituteRefresh
    // cron here.

    // Annunciation Circle member snapshot + new-member notifier.
    // Writes annunciation/latest.json (feeds the /annunciation dashboard) and
    // emails ANNUNCIATION_NOTIFY_EMAILS when new members are detected (live:
    // Regina, Zena, and Cassandra receive new-member alerts).
    new sst.aws.Cron("AnnunciationRefresh", {
      schedule: "rate(15 minutes)",
      function: {
        handler: "services/publishers/annunciation/handler.handler",
        runtime: "python3.12",
        timeout: "5 minutes",
        memory: "1024 MB",
        link: [data],
        python: { uv: true },
        copyFiles: commonFiles,
        environment: {
          DATA_BUCKET: data.name,
          API_KEY: virtuousApiKey.value,
          VIRTUOUS_API_KEY: virtuousApiKey.value,
          RESEND_API_KEY: resendApiKey.value,
          ANNUNCIATION_CACHE_KEY: "annunciation/latest.json",
          // Comma-separated recipients for new-member alerts. EMPTY = logged, not
          // sent. Fill in at go-live.
          ANNUNCIATION_NOTIFY_EMAILS:
            "regina.m.pirolli@avemaria.edu,zena.weist@avemaria.edu,cassandra.l.bournos@avemaria.edu",
          // Hub URL — new-member mail should send people to reporting.avemaria.edu,
          // not a report-specific path and not the SST Function URL.
          APP_BASE_URL: reportingUrl,
          EMAIL_FROM:
            "AMU Project Manager <noreply@notifications.avemaria.edu>",
        },
        permissions: reportDataPerms,
      },
    });

    new sst.aws.Cron("ChapelNamingRefresh", {
      schedule: "rate(15 minutes)",
      function: chapelNaming,
    });

    new sst.aws.Cron("AdvancementOverviewRefresh", {
      schedule: "rate(15 minutes)",
      function: advancementOverview,
    });

    new sst.aws.Cron("MgoTopProspectsRefresh", {
      schedule: "rate(15 minutes)",
      function: mgoTopProspects,
    });

    new sst.aws.Cron("PortfoliosRefresh", {
      schedule: "rate(15 minutes)",
      function: portfolios,
    });

    new sst.aws.Cron("MgoAnalysisRefresh", {
      // 30 minutes: full FY notes plus all-time notes per MGO author; keeps
      // headroom on the shared Virtuous rate limit.
      schedule: "rate(30 minutes)",
      function: mgoAnalysis,
    });

    new sst.aws.Cron("StainedGlassWindowsRefresh", {
      schedule: "rate(15 minutes)",
      function: stainedGlassWindows,
    });

    new sst.aws.Cron("AthleticsCoachingFundraisingRefresh", {
      schedule: "rate(15 minutes)",
      function: athleticsCoachingFundraising,
    });

    new sst.aws.Cron("AthleticsGivingRefresh", {
      schedule: "rate(15 minutes)",
      function: athleticsGiving,
    });

    // Hourly is enough: appeal figures do not need 15-minute freshness, and
    // geography does a bounded per-donor fetch.
    new sst.aws.Cron("FallAppealRefresh", {
      schedule: "rate(1 hour)",
      function: fallAppeal,
    });

    new sst.aws.Cron("SpringAppealRefresh", {
      schedule: "rate(1 hour)",
      function: springAppeal,
    });

    // Chancellor's Gala giving-site tickets. Stripe is not posting these to
    // Virtuous. 11:15 UTC is 7:15am Eastern during daylight time.
    const galaTickets = new sst.aws.Function("GalaTickets", {
      handler: "services/publishers/gala-tickets/handler.handler",
      runtime: "python3.12",
      timeout: "2 minutes",
      memory: "512 MB",
      link: [data],
      python: { uv: true },
      copyFiles: [
        ...commonFiles,
        {
          from: "apps/web-next/src/lib/reports/points/gala-site-tickets.json",
          to: "gala-site-tickets.seed.json",
        },
      ],
      environment: {
        DATA_BUCKET: data.name,
        GIVING_STRIPE_SECRET_ID: "giving/app",
      },
      permissions: [
        ...reportDataPerms,
        {
          actions: ["secretsmanager:GetSecretValue"],
          resources: [
            "arn:aws:secretsmanager:us-east-2:905418447941:secret:giving/app-iu1cSf*",
          ],
        },
      ],
    });

    new sst.aws.Cron("GalaTicketsRefresh", {
      schedule: "cron(15 11 * * ? *)",
      function: galaTickets,
    });

    // DST-627. The public POW production export returns HMAC keys plus
    // aggregates, never plaintext identities.
    new sst.aws.Cron("PursuitOfWisdomRefresh", {
      schedule: "rate(1 day)",
      function: {
        handler: "services/publishers/pursuit-of-wisdom/handler.handler",
        runtime: "python3.12",
        timeout: "5 minutes",
        memory: "1024 MB",
        link: [data],
        python: { uv: true },
        copyFiles: commonFiles,
        environment: {
          DATA_BUCKET: data.name,
          POW_REPORTING_EXPORT_URL: "https://aws-pursuit.avemaria.edu/api/internal/reporting/pursuit-of-wisdom",
          POW_REPORTING_EXPORT_TOKEN: pursuitWisdomExportToken.value,
        },
        permissions: reportDataPerms,
      },
    });

    return {
      url: reportingUrl,
      dataBucket: data.name,
      masProcess: masProcess.name,
      alumniProcess: alumniProcess.name,
      instituteData: instituteData.name,
      housingProcess: housingProcess.name,
      chapelNaming: chapelNaming.name,
      advancementOverview: advancementOverview.name,
      mgoTopProspects: mgoTopProspects.name,
      portfolios: portfolios.name,
      mgoAnalysis: mgoAnalysis.name,
      stainedGlassWindows: stainedGlassWindows.name,
      fallAppeal: fallAppeal.name,
      springAppeal: springAppeal.name,
      athleticsCoachingFundraising: athleticsCoachingFundraising.name,
      athleticsGiving: athleticsGiving.name,
      galaTickets: galaTickets.name,
    };
  },
});
