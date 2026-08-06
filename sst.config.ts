/// <reference path="./.sst/platform/config.d.ts" />

/**
 * AMU Reporting — Next.js + SST.
 * Clean publishers write directly into ReportData (DATA_BUCKET).
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
    const instituteSlateQueries = new sst.Secret("InstituteSlateQueries");
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

    const commonFiles = [
      {
        from: "services/publishers/common",
        to: "common",
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
        INSTITUTE_ALLOWED_EMAILS:
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

    new sst.aws.Cron("MasGivingRefresh", {
      schedule: "rate(15 minutes)",
      function: {
        handler: "services/publishers/mas/handler.handler",
        runtime: "python3.12",
        timeout: "15 minutes",
        memory: "2048 MB",
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
        permissions: reportDataPerms,
      },
    });

    new sst.aws.Cron("PointsRefresh", {
      schedule: "rate(15 minutes)",
      function: {
        handler: "services/publishers/points/handler.handler",
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
        },
        permissions: reportDataPerms,
      },
    });

    new sst.aws.Cron("AlumniRefresh", {
      schedule: "rate(6 hours)",
      function: {
        handler: "services/publishers/alumni/handler.handler",
        runtime: "python3.12",
        timeout: "15 minutes",
        memory: "2048 MB",
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
        permissions: reportDataPerms,
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

    new sst.aws.Cron("InstituteRefresh", {
      // q1 (all AMU apps) and q2 (prospect pool) can each take ~600s; the
      // handler fetches all six Slate queries concurrently so the run fits the
      // 15-minute ceiling. Admissions-pipeline data changes slowly, so a 6-hour
      // cadence keeps the slow queries from hammering Slate every cycle.
      schedule: "rate(6 hours)",
      function: {
        handler: "services/publishers/institute/handler.handler",
        runtime: "python3.12",
        timeout: "15 minutes",
        memory: "2048 MB",
        link: [data],
        python: { uv: true },
        environment: {
          DATA_BUCKET: data.name,
          INSTITUTE_SLATE_QUERIES: instituteSlateQueries.value,
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
