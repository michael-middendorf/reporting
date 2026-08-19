/// <reference path="./.sst/platform/config.d.ts" />

/**
 * AMU Reporting — Next.js + SST.
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
    const authSecret = new sst.Secret("AuthSecret");
    const resendApiKey = new sst.Secret("ResendApiKey");
    // The hostname users actually reach: CloudFront -> ALB -> ECS. Must stay in
    // step with `reportingUrl` in infra/lib/reporting-ecs-stack.ts, which sets
    // APP_BASE_URL for the ECS web container. Do NOT use the SST `Web`
    // component's own url here - see the note on the crons below.
    const reportingUrl = "https://dc4s8z03sfopy.cloudfront.net";
    const virtuousApiKey = new sst.Secret("VirtuousApiKey");
    const qlikApiKey = new sst.Secret("QlikApiKey");
    const qlikTenant = new sst.Secret("QlikTenant");
    const erezlifeApiKey = new sst.Secret("ErezlifeApiKey");
    const slateQueryUrl = new sst.Secret("SlateQueryUrl");
    const slateDepositsUrl = new sst.Secret("SlateDepositsUrl");
    const instituteSlateQueries = new sst.Secret("InstituteSlateQueries");
    const allowedEmails = new sst.Secret("AllowedEmails");

    const data = new sst.aws.Bucket("ReportData");

    // Single-use tracking for magic-link sign-in tokens (replay prevention).
    // Fixed name — the table itself is created in infra/lib/reporting-ecs-stack.ts
    // (that stack deploys first in CI, before "Deploy SST runtime") and both
    // deployments of this app (this Lambda "Web" component and the ECS
    // container) reference it by this same known name/ARN.
    const magicNonceTableName = "amu-reporting-magic-link-nonces";
    const magicNonceTableArn = `arn:aws:dynamodb:us-east-2:905418447941:table/${magicNonceTableName}`;

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
      ],
      environment: {
        INSTITUTE_SLATE_QUERIES: instituteSlateQueries.value,
      },
    });

    const site = new sst.aws.Nextjs("Web", {
      path: "apps/web-next",
      // SST 4.17.1 defaults to OpenNext 3.9.14, whose Node 24 image
      // optimizer fails before Sharp runs. Pin the canary-verified wrapper
      // and the patched native dependency used by the production bundle.
      openNextVersion: "4.1.0",
      link: [data, masProcess, alumniProcess, instituteData],
      // The /api/institute-data route waits on the ~15-25s live Slate fetch.
      server: { timeout: "60 seconds" },
      environment: {
        SHARP_VERSION: "0.35.3",
        AUTH_SECRET: authSecret.value,
        RESEND_API_KEY: resendApiKey.value,
        VIRTUOUS_API_KEY: virtuousApiKey.value,
        EREZLIFE_API_KEY: erezlifeApiKey.value,
        API_KEY: erezlifeApiKey.value,
        QLIK_API_KEY: qlikApiKey.value,
        QLIK_TENANT: qlikTenant.value,
        SLATE_QUERY_URL: slateQueryUrl.value,
        SLATE_DEPOSITS_URL: slateDepositsUrl.value,
        ALLOWED_EMAILS: allowedEmails.value,
        ENROLLMENT_ALLOWED_EMAILS:
          "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,michael.t.middendorf@avemaria.edu",
        HOUSING_ALLOWED_EMAILS:
          "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
        INSTITUTE_ALLOWED_EMAILS:
          "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,liam.j.orourke@avemaria.edu,garrett.j.hallinan@avemaria.edu",
        MAS_ALLOWED_EMAILS:
          "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
        POINTS_ALLOWED_EMAILS:
          "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
        ALUMNI_ALLOWED_EMAILS:
          "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
        // Annunciation-only viewers get app access + see ONLY the Annunciation
        // card (they are not admins and are on no other report's allowlist).
        // Intentionally NOT in the DailyMagicLinks allowlist below, so they get
        // no unsolicited sign-in email — they request a magic link themselves.
        ANNUNCIATION_ALLOWED_EMAILS:
          "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,cassandra.l.bournos@avemaria.edu,zena.weist@avemaria.edu,regina.m.pirolli+test@avemaria.edu",
        DATA_BUCKET: data.name,
        MAS_PROCESS_FUNCTION: masProcess.name,
        ALUMNI_PROCESS_FUNCTION: alumniProcess.name,
        INSTITUTE_FN_NAME: instituteData.name,
        MAGIC_NONCE_TABLE: magicNonceTableName,
        EMAIL_FROM:
          "AMU Project Manager <noreply@notifications.avemaria.edu>",
      },
      permissions: [
        {
          actions: ["lambda:InvokeFunction"],
          resources: [masProcess.arn, alumniProcess.arn, instituteData.arn],
        },
        {
          actions: ["dynamodb:PutItem"],
          resources: [magicNonceTableArn],
        },
      ],
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
      function: {
        handler: "services/publishers/housing/handler.handler",
        runtime: "python3.12",
        timeout: "10 minutes",
        memory: "1024 MB",
        link: [data],
        python: { uv: true },
        copyFiles: [
          ...commonFiles,
          {
            from: "services/publishers/housing/housing_data.py",
            to: "housing_data.py",
          },
        ],
        environment: {
          DATA_BUCKET: data.name,
          QLIK_API_KEY: qlikApiKey.value,
          QLIK_TENANT: qlikTenant.value,
          EREZLIFE_API_KEY: erezlifeApiKey.value,
          SLATE_QUERY_URL: slateQueryUrl.value,
          SLATE_DEPOSITS_URL: slateDepositsUrl.value,
        },
        permissions: reportDataPerms,
      },
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
          // Sign-in links must land on the ECS deployment behind CloudFront,
          // not on the SST Web component's public Lambda Function URL. Pointing
          // them at site.url sent every recipient to the vestigial deployment.
          APP_BASE_URL: reportingUrl,
          EMAIL_FROM:
            "AMU Project Manager <noreply@notifications.avemaria.edu>",
        },
        permissions: reportDataPerms,
      },
    });

    new sst.aws.Cron("DailyMagicLinks", {
      schedule: "cron(0 12 * * ? *)",
      function: {
        handler: "functions/daily-magic.handler",
        timeout: "2 minutes",
        environment: {
          AUTH_SECRET: authSecret.value,
          RESEND_API_KEY: resendApiKey.value,
          ALLOWED_EMAILS: allowedEmails.value,
          ENROLLMENT_ALLOWED_EMAILS:
            "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,michael.t.middendorf@avemaria.edu",
          HOUSING_ALLOWED_EMAILS:
            "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
          INSTITUTE_ALLOWED_EMAILS:
            "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,liam.j.orourke@avemaria.edu,garrett.j.hallinan@avemaria.edu",
          MAS_ALLOWED_EMAILS:
            "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
          POINTS_ALLOWED_EMAILS:
            "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
          ALUMNI_ALLOWED_EMAILS:
            "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
          ANNUNCIATION_ALLOWED_EMAILS:
            "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
          // Sign-in links must land on the ECS deployment behind CloudFront,
          // not on the SST Web component's public Lambda Function URL. Pointing
          // them at site.url sent every recipient to the vestigial deployment.
          APP_BASE_URL: reportingUrl,
          EMAIL_FROM:
            "AMU Project Manager <noreply@notifications.avemaria.edu>",
        },
      },
    });

    return {
      url: site.url,
      dataBucket: data.name,
      masProcess: masProcess.name,
      alumniProcess: alumniProcess.name,
      instituteData: instituteData.name,
    };
  },
});
