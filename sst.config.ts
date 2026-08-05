/// <reference path="./.sst/platform/config.d.ts" />

/**
 * AMU Reporting — Next.js + SST (form-remake secrets pattern).
 * Legacy report folders are not modified; UIs are copied into apps/web-next.
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
        DATA_BUCKET: data.name,
        ENROLLMENT_CACHE_BUCKET:
          "amu-enrollment-pipeline-slate-dashboard-cache-us-east-2",
        CACHE_BUCKET: "amu-enrollment-pipeline-slate-dashboard-cache-us-east-2",
        CACHE_KEY: "dashboard/slate-report-cache.json",
        EMAIL_FROM:
          "AMU Project Manager <noreply@notifications.avemaria.edu>",
      },
      permissions: [
        {
          actions: ["s3:GetObject", "s3:ListBucket"],
          resources: [
            "arn:aws:s3:::amu-enrollment-pipeline-slate-dashboard-cache-us-east-2",
            "arn:aws:s3:::amu-enrollment-pipeline-slate-dashboard-cache-us-east-2/*",
            "arn:aws:s3:::mas-report-report-905418447941-us-east-2",
            "arn:aws:s3:::mas-report-report-905418447941-us-east-2/*",
            "arn:aws:s3:::mas-report-cache-905418447941-us-east-2",
            "arn:aws:s3:::mas-report-cache-905418447941-us-east-2/*",
          ],
        },
      ],
    });

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
          CACHE_BUCKET:
            "amu-enrollment-pipeline-slate-dashboard-cache-us-east-2",
        },
        permissions: [
          {
            actions: ["s3:GetObject", "s3:PutObject", "s3:ListBucket"],
            resources: [
              "arn:aws:s3:::amu-enrollment-pipeline-slate-dashboard-cache-us-east-2",
              "arn:aws:s3:::amu-enrollment-pipeline-slate-dashboard-cache-us-east-2/*",
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
          APP_BASE_URL: site.url,
          EMAIL_FROM:
            "AMU Project Manager <noreply@notifications.avemaria.edu>",
        },
      },
    });

    return { url: site.url, dataBucket: data.name };
  },
});
