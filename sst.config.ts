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
      permissions: readDataPerms,
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
      environment: {
        INSTITUTE_SLATE_QUERIES: instituteSlateQueries.value,
      },
    });

    const site = new sst.aws.Nextjs("Web", {
      path: "apps/web-next",
      link: [data, masProcess, alumniProcess, instituteData],
      // The /api/institute-data route waits on the ~15-25s live Slate fetch.
      server: { timeout: "60 seconds" },
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
        MAS_PROCESS_FUNCTION: masProcess.name,
        ALUMNI_PROCESS_FUNCTION: alumniProcess.name,
        INSTITUTE_FN_NAME: instituteData.name,
        EMAIL_FROM:
          "AMU Project Manager <noreply@notifications.avemaria.edu>",
      },
      permissions: [
        {
          actions: ["lambda:InvokeFunction"],
          resources: [masProcess.arn, alumniProcess.arn, instituteData.arn],
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

    // Institute data is now fetched live per page load by the InstituteData
    // function (defined above), not published on a cron — so no InstituteRefresh
    // cron here.

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

    return {
      url: site.url,
      dataBucket: data.name,
      masProcess: masProcess.name,
      alumniProcess: alumniProcess.name,
    };
  },
});
