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

    const data = new sst.aws.Bucket("ReportData");

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

    // AthleticsSlateQueries JSON: applications + prospects required; roster
    // optional (queries[].name=roster). Missing roster skips that dataset.
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
      stainedGlassWindows: stainedGlassWindows.name,
      fallAppeal: fallAppeal.name,
      springAppeal: springAppeal.name,
      athleticsCoachingFundraising: athleticsCoachingFundraising.name,
      athleticsGiving: athleticsGiving.name,
    };
  },
});
