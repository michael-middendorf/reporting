/// <reference path="./.sst/platform/config.d.ts" />

/**
 * AMU Reporting — Next.js + SST.
 * Publishers write directly into ReportData (DATA_BUCKET). App reads only that bucket.
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
    const virtuousApiKey = new sst.Secret("VirtuousApiKey");
    const qlikApiKey = new sst.Secret("QlikApiKey");
    const qlikTenant = new sst.Secret("QlikTenant");
    const erezlifeApiKey = new sst.Secret("ErezlifeApiKey");
    const slateQueryUrl = new sst.Secret("SlateQueryUrl");
    const slateDepositsUrl = new sst.Secret("SlateDepositsUrl");
    const allowedEmails = new sst.Secret("AllowedEmails");

    const data = new sst.aws.Bucket("ReportData");

    const reportDataPerms = [
      {
        actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket", "s3:DeleteObject"],
        resources: [
          $interpolate`arn:aws:s3:::${data.name}`,
          $interpolate`arn:aws:s3:::${data.name}/*`,
        ],
      },
    ];

    const site = new sst.aws.Nextjs("Web", {
      path: "apps/web-next",
      link: [data],
      environment: {
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
        MAS_ALLOWED_EMAILS:
          "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
        POINTS_ALLOWED_EMAILS:
          "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
        ALUMNI_ALLOWED_EMAILS:
          "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
        DATA_BUCKET: data.name,
        ENROLLMENT_MANIFEST_KEY: "enrollment/slate-report-cache.json",
        EMAIL_FROM:
          "AMU Project Manager <noreply@notifications.avemaria.edu>",
      },
    });

    // Slate enrollment → ReportData/enrollment/
    new sst.aws.Cron("EnrollmentRefresh", {
      schedule: "rate(15 minutes)",
      function: {
        handler:
          "services/refresh/enrollment_pipeline/slate_dashboard_cache_lambda.lambda_handler",
        runtime: "python3.12",
        timeout: "15 minutes",
        memory: "1024 MB",
        link: [data],
        python: { uv: true },
        copyFiles: [
          {
            from: "services/refresh/enrollment_pipeline/real-query-links.json",
            to: "real-query-links.json",
          },
        ],
        environment: {
          CACHE_BUCKET: data.name,
          CACHE_KEY: "enrollment/slate-report-cache.json",
        },
        permissions: reportDataPerms,
      },
    });

    // Virtuous MAS giving artifacts → ReportData/mas/data/
    new sst.aws.Cron("MasGivingRefresh", {
      schedule: "rate(15 minutes)",
      function: {
        handler: "services/refresh/mas_giving/handler.handler",
        runtime: "python3.12",
        timeout: "15 minutes",
        memory: "2048 MB",
        link: [data],
        python: { uv: true },
        copyFiles: [
          {
            from: "services/refresh/mas_giving/backend/src/mas_report_backend",
            to: "mas_report_backend",
          },
          {
            from: "services/refresh/mas_giving/mas_follow_up_report",
            to: "mas_follow_up_report",
          },
        ],
        environment: {
          MAS_REPORT_REPORT_BUCKET: data.name,
          MAS_REPORT_REPORT_PREFIX: "mas/data",
          API_KEY: virtuousApiKey.value,
          VIRTUOUS_API_KEY: virtuousApiKey.value,
        },
        permissions: reportDataPerms,
      },
    });

    // Virtuous MA points raw JSON → ReportData/points/data/
    new sst.aws.Cron("PointsRefresh", {
      schedule: "rate(15 minutes)",
      function: {
        handler: "services/refresh/mas_points/handler.handler",
        runtime: "python3.12",
        timeout: "15 minutes",
        memory: "1024 MB",
        link: [data],
        python: { uv: true },
        copyFiles: [
          {
            from: "services/refresh/mas_points/backend/src/mas_cache",
            to: "mas_cache",
          },
        ],
        environment: {
          MAS_CACHE_BUCKET: data.name,
          MAS_CACHE_PREFIX: "points/data",
          API_KEY: virtuousApiKey.value,
          VIRTUOUS_API_KEY: virtuousApiKey.value,
        },
        permissions: reportDataPerms,
      },
    });

    // Alumni coverage → ReportData/alumni/
    new sst.aws.Cron("AlumniRefresh", {
      schedule: "rate(6 hours)",
      function: {
        handler: "services/refresh/alumni/handler.handler",
        runtime: "python3.12",
        timeout: "15 minutes",
        memory: "2048 MB",
        link: [data],
        python: { uv: true },
        copyFiles: [
          {
            from: "services/refresh/alumni/lambda_handler.py",
            to: "lambda_handler.py",
          },
          {
            from: "services/refresh/alumni/virt_reporting",
            to: "virt_reporting",
          },
        ],
        environment: {
          DATA_BUCKET: data.name,
          ALUMNI_DATA_PREFIX: "alumni",
          PUBLISH_DIR: "/tmp/alumni_publish",
          API_KEY: virtuousApiKey.value,
          VIRTUOUS_API_KEY: virtuousApiKey.value,
        },
        permissions: reportDataPerms,
      },
    });

    new sst.aws.Cron("HousingRefresh", {
      schedule: "rate(6 hours)",
      function: {
        handler: "services/refresh/housing_refresh/handler.handler",
        runtime: "python3.12",
        timeout: "10 minutes",
        memory: "1024 MB",
        link: [data],
        python: { uv: true },
        copyFiles: [
          {
            from: "services/api/reporting_api",
            to: "reporting_api",
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
          MAS_ALLOWED_EMAILS:
            "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
          POINTS_ALLOWED_EMAILS:
            "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
          ALUMNI_ALLOWED_EMAILS:
            "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu",
          APP_BASE_URL: site.url,
          EMAIL_FROM:
            "AMU Project Manager <noreply@notifications.avemaria.edu>",
        },
      },
    });

    return { url: site.url, dataBucket: data.name };
  },
});
