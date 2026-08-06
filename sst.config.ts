/// <reference path="./.sst/platform/config.d.ts" />

/**
 * AMU Reporting — Next.js + SST.
 * All app reads go to ReportData (DATA_BUCKET). Legacy source buckets are
 * copy-synced in (never modified) so external reports keep working.
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

    const enrollmentSource =
      "amu-enrollment-pipeline-slate-dashboard-cache-us-east-2";
    const masSource = "mas-report-cache-905418447941-us-east-2";

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

    // Legacy enrollment publisher — still fills the old cache bucket for other consumers.
    new sst.aws.Cron("EnrollmentRefresh", {
      schedule: "rate(15 minutes)",
      function: {
        handler:
          "services/refresh/enrollment_pipeline/slate_dashboard_cache_lambda.lambda_handler",
        runtime: "python3.12",
        timeout: "15 minutes",
        memory: "1024 MB",
        copyFiles: [
          {
            from: "services/refresh/enrollment_pipeline/real-query-links.json",
            to: "real-query-links.json",
          },
        ],
        environment: {
          CACHE_BUCKET: enrollmentSource,
        },
        permissions: [
          {
            actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
            resources: [
              `arn:aws:s3:::${enrollmentSource}`,
              `arn:aws:s3:::${enrollmentSource}/*`,
            ],
          },
        ],
      },
    });

    // Copy legacy caches → ReportData (read-only on sources).
    new sst.aws.Cron("ReportDataSync", {
      schedule: "rate(15 minutes)",
      function: {
        handler: "services/refresh/report_data_sync/handler.handler",
        runtime: "python3.12",
        timeout: "10 minutes",
        memory: "1024 MB",
        link: [data],
        python: { uv: true },
        environment: {
          DATA_BUCKET: data.name,
          ENROLLMENT_SOURCE_BUCKET: enrollmentSource,
          MAS_SOURCE_BUCKET: masSource,
        },
        permissions: [
          {
            actions: ["s3:GetObject", "s3:ListBucket"],
            resources: [
              `arn:aws:s3:::${enrollmentSource}`,
              `arn:aws:s3:::${enrollmentSource}/*`,
              `arn:aws:s3:::${masSource}`,
              `arn:aws:s3:::${masSource}/*`,
            ],
          },
          {
            actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
            resources: [
              $interpolate`arn:aws:s3:::${data.name}`,
              $interpolate`arn:aws:s3:::${data.name}/*`,
            ],
          },
        ],
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
        permissions: [
          {
            actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
            resources: [
              $interpolate`arn:aws:s3:::${data.name}`,
              $interpolate`arn:aws:s3:::${data.name}/*`,
            ],
          },
        ],
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
