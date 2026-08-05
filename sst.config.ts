/// <reference path="./.sst/platform/config.d.ts" />

/**
 * AMU Reporting — SST stack (same secrets pattern as undergraduate-form-remake).
 *
 * Secrets are stored by SST (SSM). Set once per stage; every `sst deploy`
 * (including CI on main) re-injects them into Lambda environment:
 *
 *   npx sst secret set AuthSecret '…' --stage production
 *   npx sst secret set ResendApiKey '…' --stage production
 *   npx sst secret set VirtuousApiKey '…' --stage production
 *   npx sst secret set QlikApiKey '…' --stage production
 *   npx sst secret set QlikTenant 'tenant.region.qlikcloud.com' --stage production
 *   npx sst secret set ErezlifeApiKey '…' --stage production
 *   npx sst secret set SlateQueryUrl 'https://…' --stage production
 *   npx sst secret set SlateDepositsUrl 'https://…' --stage production
 *   npx sst secret set AllowedEmails 'a@avemaria.edu,b@avemaria.edu' --stage production
 *
 * CI only needs AWS_DEPLOY_ROLE_ARN (OIDC). App secrets are not duplicated in GitHub.
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
    const router = new sst.aws.Router("Router");

    const api = new sst.aws.Function("Api", {
      handler: "services/api/reporting_api/handler.lambda_handler",
      runtime: "python3.12",
      timeout: "2 minutes",
      memory: "1024 MB",
      url: true,
      link: [data],
      environment: {
        AUTH_SECRET: authSecret.value,
        RESEND_API_KEY: resendApiKey.value,
        VIRTUOUS_API_KEY: virtuousApiKey.value,
        EREZLIFE_API_KEY: erezlifeApiKey.value,
        API_KEY: erezlifeApiKey.value,
        SITE_URL: "https://avemaria.erezlife.com/",
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
        TARGET_SESSION: "2026FALL01",
        DATA_DIR: "/tmp",
        EMAIL_FROM:
          "AMU Project Manager <noreply@notifications.avemaria.edu>",
        APP_BASE_URL: router.url,
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

    router.route(
      "/api",
      api.url.apply((u) => (u ? u.replace(/\/$/, "") : "")),
    );

    const web = new sst.aws.StaticSite("Web", {
      path: "apps/web",
      build: {
        command: "npm ci && npm run build",
        output: "dist",
      },
      errorPage: "index.html",
      router: {
        instance: router,
      },
    });

    new sst.aws.Cron("DailyMagicLinks", {
      schedule: "cron(0 12 * * ? *)",
      function: {
        handler: "services/api/reporting_api/handler.lambda_handler",
        runtime: "python3.12",
        timeout: "2 minutes",
        memory: "512 MB",
        environment: {
          AUTH_SECRET: authSecret.value,
          RESEND_API_KEY: resendApiKey.value,
          ALLOWED_EMAILS: allowedEmails.value,
          APP_BASE_URL: router.url,
          EMAIL_FROM:
            "AMU Project Manager <noreply@notifications.avemaria.edu>",
        },
      },
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

    return {
      url: router.url,
      apiUrl: api.url,
      dataBucket: data.name,
      webUrl: web.url,
    };
  },
});
