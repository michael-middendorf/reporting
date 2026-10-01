import * as cdk from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import * as path from "node:path";

const account = "905418447941";
const region = "us-east-2";
const dataBucketArn = `arn:aws:s3:::amu-reporting-production-reportdatabucket-rncvucke`;
const reportingUrl = "https://dc4s8z03sfopy.cloudfront.net";
const reportingOriginHeaderName = "X-Reporting-Origin";
const reportingOriginHeaderValue = "9796ae3e6c84e98ba520f802cf5cf5db";
// Fixed name so the separately-deployed SST stack (sst.config.ts, the public
// Function URL "Web" component) can reference the same table by a known
// ARN, the same way this stack already references SST-created resources
// (dataBucketArn, onDemandFns) by hardcoded name rather than a lookup.
const magicNonceTableName = "amu-reporting-magic-link-nonces";
const aspireduSessionTableName = "amu-reporting-aspiredu-sessions";
const aspireduCallbackUrl = `${reportingUrl}/aspiredu/api/auth/callback`;
// Custom domain, registered alongside the CloudFront hostname so both work
// through cutover. Cognito rejects any redirect_uri not on the callback list.
const reportingDomainUrl = "https://reporting.avemaria.edu";
const aspireduDomainCallbackUrl = `${reportingDomainUrl}/aspiredu/api/auth/callback`;
const aspireduAllowedEmails = "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,michael.t.middendorf@avemaria.edu,daniel.davy@avemaria.edu,michaelene.hayward@avemaria.edu,maria.t.gomez@avemaria.edu,alexandra.r.baalman@avemaria.edu";

export class ReportingEcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const vpc = ec2.Vpc.fromLookup(this, "DefaultVpc", { isDefault: true });
    const cluster = new ecs.Cluster(this, "Cluster", { vpc, clusterName: "amu-reporting", containerInsightsV2: ecs.ContainerInsights.ENABLED });
    // avemaria-alb only has AZ mappings for us-east-2a and us-east-2b (no us-east-2c).
    // Pin tasks to those AZs via the account-wide ecs-private-2a/2b subnets so they
    // register in the ALB target group without public IPs (Security Hub ECS.2).
    // Select by subnet ID: CDK's default-VPC lookup misses these /24s because egress
    // is a NAT instance, not a NAT Gateway (do not use SubnetType.PUBLIC).
    const ecsPrivateSubnets = {
      subnets: [
        ec2.Subnet.fromSubnetAttributes(this, "EcsPrivate2a", { subnetId: "subnet-0be5c13dc5c2fde89", availabilityZone: "us-east-2a", routeTableId: "rtb-0a7b29b7d187b8328" }),
        ec2.Subnet.fromSubnetAttributes(this, "EcsPrivate2b", { subnetId: "subnet-071cbec0a09d5139d", availabilityZone: "us-east-2b", routeTableId: "rtb-0a7b29b7d187b8328" }),
      ],
    };
    const secret = secrets.Secret.fromSecretNameV2(this, "RuntimeSecret", "amu-reporting/production/runtime");
    // The Resend key lives in its OWN single-string secret rather than as one field of the
    // 18-key runtime document above. Secrets Manager cannot patch a single JSON field, so a
    // rotation of the blob means reading and rewriting every other value in it (AUTH_SECRET
    // included) just to change one string. Splitting it out makes rotation a single
    // put-secret-value, and matches how housing-dashboard, enrollment-dashboard,
    // avemaria-api and scholarship-app already store theirs.
    const resendSecret = secrets.Secret.fromSecretNameV2(this, "ResendApiKeySecret", "amu-reporting/production/resend-api-key");
    const xaiSecret = secrets.Secret.fromSecretNameV2(this, "XaiApiKeySecret", "amu-reporting/production/xai-api-key");
    // Read-only PowerCampus SQL login (amu_reporting_ro) for the powercampus worker job.
    // JSON keys: host, port, database, username, password. Worker task only, never web.
    const powercampusSecret = secrets.Secret.fromSecretNameV2(this, "PowerCampusSecret", "amu-reporting/production/powercampus");
    // Single-use tracking for magic-link sign-in tokens (replay prevention).
    // TTL'd on `expiresAt` (the token's own exp) so used/expired nonces don't
    // accumulate; PutItem is conditional (attribute_not_exists) at the call
    // site, not here — this table only needs to exist and be writable.
    const magicNonceTable = new dynamodb.Table(this, "MagicLinkNonces", {
      tableName: magicNonceTableName,
      partitionKey: { name: "nonce", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
    });
    const aspireduKey = new kms.Key(this, "AspireduReportingKey", {
      alias: "alias/amu-reporting-aspiredu",
      description: "Encrypts AspireDU reporting MFA sessions",
      enableKeyRotation: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pendingWindow: cdk.Duration.days(30),
    });
    const aspireduSessionTable = new dynamodb.Table(this, "AspireduSessions", {
      tableName: aspireduSessionTableName,
      partitionKey: { name: "sessionId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: aspireduKey,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
    });
    const aspireduUserPool = new cognito.UserPool(this, "AspireduUserPool", {
      userPoolName: "amu-reporting-aspiredu",
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { sms: false, otp: true },
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      passwordPolicy: {
        minLength: 14,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: cdk.Duration.days(7),
        passwordHistorySize: 10,
      },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const aspireduDomain = aspireduUserPool.addDomain("AspireduDomain", {
      cognitoDomain: { domainPrefix: `amu-reporting-aspiredu-${account}` },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });
    const aspireduClient = aspireduUserPool.addClient("AspireduWebClient", {
      userPoolClientName: "amu-reporting-aspiredu-web",
      generateSecret: false,
      preventUserExistenceErrors: true,
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [aspireduCallbackUrl, aspireduDomainCallbackUrl],
        logoutUrls: [`${reportingUrl}/aspiredu`, `${reportingDomainUrl}/aspiredu`],
      },
      accessTokenValidity: cdk.Duration.minutes(15),
      idTokenValidity: cdk.Duration.minutes(15),
      refreshTokenValidity: cdk.Duration.hours(8),
      refreshTokenRotationGracePeriod: cdk.Duration.seconds(0),
      enableTokenRevocation: true,
    });
    // Managed login v2 (NEWER_MANAGED_LOGIN) serves "Login pages unavailable"
    // until a branding style is attached to the app client. CLI/CDK do not
    // auto-assign one the way the console does.
    new cognito.CfnManagedLoginBranding(this, "AspireduLoginBranding", {
      userPoolId: aspireduUserPool.userPoolId,
      clientId: aspireduClient.userPoolClientId,
      useCognitoProvidedValues: true,
    });
    for (const email of aspireduAllowedEmails.split(",")) {
      const id = email.split("@")[0].replace(/[^a-z0-9]+/gi, "");
      new cognito.CfnUserPoolUser(this, `AspireduUser${id}`, {
        userPoolId: aspireduUserPool.userPoolId,
        username: email,
        desiredDeliveryMediums: ["EMAIL"],
        userAttributes: [
          { name: "email", value: email },
          { name: "email_verified", value: "true" },
        ],
      });
    }
    const webLogs = new logs.LogGroup(this, "WebLogs", { logGroupName: "/ecs/amu-reporting/web-v3", retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.RETAIN });
    const workerLogs = new logs.LogGroup(this, "WorkerLogs", { logGroupName: "/ecs/amu-reporting/worker-v3", retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.RETAIN });
    const webImage = new ecrAssets.DockerImageAsset(this, "WebImage", { directory: path.join(__dirname, "../.."), file: "Dockerfile.web" });
    const workerImage = new ecrAssets.DockerImageAsset(this, "WorkerImage", { directory: path.join(__dirname, "../.."), file: "Dockerfile.worker" });
    const webSg = new ec2.SecurityGroup(this, "WebSg", { vpc, description: "AMU reporting web tasks", allowAllOutbound: true });
    const task = new ecs.FargateTaskDefinition(this, "WebTask", { cpu: 512, memoryLimitMiB: 1024 });
    secret.grantRead(task.obtainExecutionRole());
    grantGuardDutyAgentPull(task.obtainExecutionRole());
    task.addToTaskRolePolicy(new iam.PolicyStatement({ actions: ["s3:GetObject", "s3:ListBucket"], resources: [dataBucketArn, `${dataBucketArn}/*`] }));
    // Points count/remove overrides and reporting-only event hours: the web app
    // persists each as a single object. Scope the write narrowly (least privilege)
    // — reads are already covered by the GetObject grant above.
    task.addToTaskRolePolicy(new iam.PolicyStatement({
      actions: ["s3:PutObject"],
      resources: [
        `${dataBucketArn}/points/review-flags.json`,
        `${dataBucketArn}/points/tracked-events.json`,
      ],
    }));
    // Housing verification/uploads: staff xlsx + edit state under cache/housing/.
    task.addToTaskRolePolicy(new iam.PolicyStatement({ actions: ["s3:PutObject"], resources: [`${dataBucketArn}/cache/housing/*`] }));
    // Appeals imports are aggregate-only and intentionally limited to the two
    // reviewed campaigns and three datasets. Adding a campaign requires a PR.
    task.addToTaskRolePolicy(new iam.PolicyStatement({ actions: ["s3:PutObject"], resources: [
      `${dataBucketArn}/fall-appeal/email-performance.json`,
      `${dataBucketArn}/appeals/fall-2026/imports/mail.json`,
      `${dataBucketArn}/appeals/fall-2026/imports/email.json`,
      `${dataBucketArn}/appeals/fall-2026/imports/digital.json`,
      `${dataBucketArn}/appeals/spring-2026/imports/mail.json`,
      `${dataBucketArn}/appeals/spring-2026/imports/email.json`,
      `${dataBucketArn}/appeals/spring-2026/imports/digital.json`,
    ] }));
    // Office-hours below-A/B ledger: persist firstSeen so coaches see duration, not today.
    task.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject"],
        resources: [`${dataBucketArn}/athletics-coaching-academics/*`],
      }),
    );
    const aspireduAggregateBucket = "aspiredudatatransferstack-aggregatebucket62f91ffa-aaetik2gcfbf";
    task.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject", "s3:ListBucket"],
        resources: [`arn:aws:s3:::${aspireduAggregateBucket}`, `arn:aws:s3:::${aspireduAggregateBucket}/*`],
      }),
    );
    task.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:Query"],
        resources: [`arn:aws:dynamodb:${region}:${account}:table/amu-aspiredu-student-snapshots`],
      }),
    );
    task.addToTaskRolePolicy(new iam.PolicyStatement({
      actions: ["kms:Decrypt", "kms:DescribeKey"],
      resources: ["arn:aws:kms:us-east-2:905418447941:key/b3537eed-7c05-488b-ab94-bd6d452394ad"],
    }));
    // On-demand report Lambdas (Institute/MAS/Alumni) live in the SST runtime; the
    // web app invokes them by name (see /api/institute-data, /api/reports/mas, alumni).
    // The web container needs both the function names AND permission to invoke them.
    const onDemandFns = {
      INSTITUTE_FN_NAME: "amu-reporting-production-InstituteDataFunction-trtxkdvv",
      MAS_PROCESS_FUNCTION: "amu-reporting-production-MasProcessFunction-xzhzvdkw",
      ALUMNI_PROCESS_FUNCTION: "amu-reporting-production-AlumniProcessFunction-vuhfevxd",
      ADVANCEMENT_OVERVIEW_FN_NAME:
        "amu-reportin-production-AdvancementOverviewDataFunction-bdadrzku",
    };
    task.addToTaskRolePolicy(new iam.PolicyStatement({
      actions: ["lambda:InvokeFunction"],
      resources: Object.values(onDemandFns).map((n) => `arn:aws:lambda:${region}:${account}:function:${n}`),
    }));
    const aspireduFns = {
      ASPIREDU_SUMMARY_FUNCTION: "amu-aspiredu-summary",
      ASPIREDU_STUDENTS_FUNCTION: "amu-aspiredu-students",
    };
    task.addToTaskRolePolicy(new iam.PolicyStatement({
      actions: ["lambda:InvokeFunction"],
      resources: Object.values(aspireduFns).map((n) => `arn:aws:lambda:${region}:${account}:function:${n}`),
    }));
    magicNonceTable.grantWriteData(task.taskRole);
    aspireduSessionTable.grantReadWriteData(task.taskRole);
    task.addVolume({ name: "tmp" });
    task.addVolume({ name: "next-cache" });
    task.addContainer("web", { image: ecs.ContainerImage.fromDockerImageAsset(webImage), portMappings: [{ containerPort: 3000 }], logging: ecs.LogDrivers.awsLogs({ logGroup: webLogs, streamPrefix: "web" }), environment: { DATA_BUCKET: "amu-reporting-production-reportdatabucket-rncvucke", APP_BASE_URL: reportingDomainUrl, ENTRA_TENANT_ID: "7f4bc07b-d9b5-43c4-a1d6-bce660187973", ENTRA_CLIENT_ID: "66a8909d-d22e-41bf-9092-4dbe06e393b0", CORE_API_URL: "https://core.avemaria.edu", MAGIC_NONCE_TABLE: magicNonceTableName, ASPIREDU_SESSION_TABLE: aspireduSessionTableName, ASPIREDU_USER_POOL_ID: aspireduUserPool.userPoolId, ASPIREDU_USER_POOL_CLIENT_ID: aspireduClient.userPoolClientId, ASPIREDU_COGNITO_DOMAIN: aspireduDomain.baseUrl(), ASPIREDU_CALLBACK_URL: aspireduCallbackUrl, ASPIREDU_CALLBACK_URLS: [aspireduCallbackUrl, aspireduDomainCallbackUrl].join(","), ASPIREDU_ALLOWED_EMAILS: aspireduAllowedEmails, ...onDemandFns, ...aspireduFns }, secrets: runtimeSecrets(secret, resendSecret, xaiSecret), readonlyRootFilesystem: true, user: "node" }).addMountPoints(
      { sourceVolume: "tmp", containerPath: "/tmp", readOnly: false },
      { sourceVolume: "next-cache", containerPath: "/app/.next/cache", readOnly: false },
    );
    const service = new ecs.FargateService(this, "WebService", { cluster, taskDefinition: task, desiredCount: 1, assignPublicIp: false, securityGroups: [webSg], vpcSubnets: ecsPrivateSubnets, circuitBreaker: { rollback: true }, minHealthyPercent: 100, maxHealthyPercent: 200 });
    webSg.addIngressRule(ec2.Peer.securityGroupId("sg-0c7c300cac7664317"), ec2.Port.tcp(3000), "HTTPS traffic from shared ALB");
    const tg = new elbv2.ApplicationTargetGroup(this, "WebTargets", { vpc, port: 3000, protocol: elbv2.ApplicationProtocol.HTTP, targetType: elbv2.TargetType.IP, healthCheck: { path: "/api/health" } });
    service.attachToApplicationTargetGroup(tg);
    new elbv2.CfnListenerRule(this, "TemporaryCloudFrontRule", { listenerArn: `arn:aws:elasticloadbalancing:${region}:${account}:listener/app/avemaria-alb/57b406e2fc6d6c5c/2292cb613158c683`, priority: 35, conditions: [{ field: "http-header", httpHeaderConfig: { httpHeaderName: reportingOriginHeaderName, values: [reportingOriginHeaderValue] } }], actions: [{ type: "forward", targetGroupArn: tg.targetGroupArn }] });
    const worker = new ecs.FargateTaskDefinition(this, "WorkerTask", { cpu: 1024, memoryLimitMiB: 3072 });
    secret.grantRead(worker.obtainExecutionRole());
    powercampusSecret.grantRead(worker.obtainExecutionRole());
    grantGuardDutyAgentPull(worker.obtainExecutionRole());
    // Worker-only secrets, kept out of runtimeSecrets() because that is shared with web.
    const powercampusSecrets = {
      PC_HOST: ecs.Secret.fromSecretsManager(powercampusSecret, "host"),
      PC_PORT: ecs.Secret.fromSecretsManager(powercampusSecret, "port"),
      PC_DATABASE: ecs.Secret.fromSecretsManager(powercampusSecret, "database"),
      PC_USERNAME: ecs.Secret.fromSecretsManager(powercampusSecret, "username"),
      PC_PASSWORD: ecs.Secret.fromSecretsManager(powercampusSecret, "password"),
    };
    worker.addToTaskRolePolicy(new iam.PolicyStatement({ actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"], resources: [dataBucketArn, `${dataBucketArn}/*`] }));
    worker.addVolume({ name: "tmp" });
    worker.addContainer("worker", { image: ecs.ContainerImage.fromDockerImageAsset(workerImage), logging: ecs.LogDrivers.awsLogs({ logGroup: workerLogs, streamPrefix: "worker" }), environment: { DATA_BUCKET: "amu-reporting-production-reportdatabucket-rncvucke" }, secrets: { ...runtimeSecrets(secret, resendSecret, xaiSecret), ...powercampusSecrets }, readonlyRootFilesystem: true, user: "reporting" }).addMountPoints(
      { sourceVolume: "tmp", containerPath: "/tmp", readOnly: false },
    );
    for (const [name, schedule, action] of [["Enrollment", events.Schedule.rate(cdk.Duration.minutes(15)), "enrollment"], ["Virtuous", events.Schedule.rate(cdk.Duration.minutes(15)), "virtuous"], ["Housing", events.Schedule.rate(cdk.Duration.hours(6)), "housing"], ["Institute", events.Schedule.rate(cdk.Duration.hours(6)), "institute"]] as const) {
      new events.Rule(this, `${name}Schedule`, { enabled: false, schedule, targets: [new targets.EcsTask({ cluster, taskDefinition: worker, taskCount: 1, subnetSelection: ecsPrivateSubnets, assignPublicIp: false, containerOverrides: [{ containerName: "worker", command: [action] }] })] });
    }
    // Nightly read-only PowerCampus pull. 07:30 UTC is 03:30 ET in EDT and 02:30 ET in EST,
    // inside the handler's allowed window (it refuses 07:00 to 22:00 America/New_York).
    new events.Rule(this, "PowerCampusSchedule", { enabled: true, schedule: events.Schedule.cron({ minute: "30", hour: "7" }), targets: [new targets.EcsTask({ cluster, taskDefinition: worker, taskCount: 1, subnetSelection: ecsPrivateSubnets, assignPublicIp: false, containerOverrides: [{ containerName: "worker", command: ["powercampus"] }] })] });
    // PowerFAIDS (financial aid) and Great Plains (finance) nightly pulls. Each source is
    // isolated from the other and from every other job: its own task definition, execution
    // role (reads only its own secret), task role (only its own S3 prefix), customer KMS key,
    // security group (443 + 1433 to its one SQL host), and log group. The bucket policy in
    // sst.config.ts denies every other principal on these prefixes. Schedules start disabled
    // until the Firepower rule, SQL logins and secrets exist and a dry run passes.
    for (const src of isolatedSqlSources) {
      isolatedSqlSource(this, src, { vpc, cluster, workerImage, ecsPrivateSubnets });
    }
    new cdk.CfnOutput(this, "AspireduUserPoolId", { value: aspireduUserPool.userPoolId });
    new cdk.CfnOutput(this, "AspireduUserPoolClientId", { value: aspireduClient.userPoolClientId });
    new cdk.CfnOutput(this, "AspireduLoginDomain", { value: aspireduDomain.baseUrl() });
  }
}

// Break-glass reader for the isolated sources (and the only human allowed by the bucket policy).
// Keep in sync with breakGlassReaders in sst.config.ts.
const breakGlassUserArn = `arn:aws:iam::${account}:user/michael-middendorf`;
// AWS-managed prefix list com.amazonaws.us-east-2.s3.
const s3PrefixListId = "pl-7ba54012";

type IsolatedSqlSourceConfig = {
  /** Worker action, S3 source name, and resource name stem. */
  source: "powerfaids" | "greatplains";
  /** CDK id prefix. */
  id: string;
  /** Env prefix the handler reads (PF_HOST, GP_HOST, ...). */
  envPrefix: string;
  /** The one SQL Server this job may reach, /32. */
  sqlHost: string;
  /** UTC schedule. Handler refuses 07:00 to 22:00 America/New_York. */
  cron: { minute: string; hour: string };
  /** Task memory. Each dataset is held in memory before upload (GL history is the largest). */
  memoryLimitMiB: number;
};

// Fixed role names: sst.config.ts references these ARNs in the bucket policy.
export const isolatedSqlSources: IsolatedSqlSourceConfig[] = [
  // 07:50 UTC = 03:50 EDT / 02:50 EST, after PowerCampus (07:30 UTC).
  { source: "powerfaids", id: "PowerFaids", envPrefix: "PF", sqlHost: "10.1.27.12/32", cron: { minute: "50", hour: "7" }, memoryLimitMiB: 2048 },
  // 08:10 UTC = 04:10 EDT / 03:10 EST.
  { source: "greatplains", id: "GreatPlains", envPrefix: "GP", sqlHost: "10.1.27.211/32", cron: { minute: "10", hour: "8" }, memoryLimitMiB: 4096 },
];

function isolatedSqlSource(
  scope: Construct,
  cfg: IsolatedSqlSourceConfig,
  ctx: { vpc: ec2.IVpc; cluster: ecs.ICluster; workerImage: ecrAssets.DockerImageAsset; ecsPrivateSubnets: ec2.SubnetSelection },
) {
  const prefix = `sources/${cfg.source}`;
  const sourceSecret = secrets.Secret.fromSecretNameV2(scope, `${cfg.id}Secret`, `amu-reporting/production/${cfg.source}`);
  const taskRole = new iam.Role(scope, `${cfg.id}TaskRole`, {
    roleName: `amu-reporting-${cfg.source}-task`,
    assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    description: `Nightly ${cfg.source} publisher: writes only ${prefix}/ with its own KMS key`,
  });
  const executionRole = new iam.Role(scope, `${cfg.id}ExecutionRole`, {
    roleName: `amu-reporting-${cfg.source}-execution`,
    assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    description: `Pulls the worker image and reads only amu-reporting/production/${cfg.source}`,
  });
  // Key policy: account root (required so the key stays manageable) plus an explicit deny of
  // data-plane use by anyone except this source's task role and the break-glass user. The deny
  // means an IAM policy with kms:* on "*" elsewhere in the account still cannot decrypt.
  const key = new kms.Key(scope, `${cfg.id}Key`, {
    alias: `alias/amu-reporting-${cfg.source}`,
    description: `Encrypts ${prefix}/ in the reporting data bucket`,
    enableKeyRotation: true,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
    pendingWindow: cdk.Duration.days(30),
  });
  key.addToResourcePolicy(new iam.PolicyStatement({
    sid: "DenyDataUseExceptSourceRole",
    effect: iam.Effect.DENY,
    principals: [new iam.AnyPrincipal()],
    actions: ["kms:Decrypt", "kms:Encrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*"],
    resources: ["*"],
    conditions: { ArnNotEquals: { "aws:PrincipalArn": [taskRole.roleArn, breakGlassUserArn] } },
  }));
  // Granted in the role's IAM policy (the key policy's root statement delegates to IAM) rather
  // than naming the brand-new role in the key policy, which KMS can reject before IAM propagates.
  taskRole.addToPolicy(new iam.PolicyStatement({
    actions: ["kms:Decrypt", "kms:GenerateDataKey"],
    resources: [key.keyArn],
    conditions: { StringEquals: { "kms:ViaService": `s3.${region}.amazonaws.com` } },
  }));
  // S3: own prefix only. Listing is limited to the prefix (pruning old dt= folders).
  taskRole.addToPolicy(new iam.PolicyStatement({
    actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
    resources: [`${dataBucketArn}/${prefix}/*`],
  }));
  taskRole.addToPolicy(new iam.PolicyStatement({
    actions: ["s3:ListBucket"],
    resources: [dataBucketArn],
    conditions: { StringLike: { "s3:prefix": [`${prefix}/*`] } },
  }));
  const logGroup = new logs.LogGroup(scope, `${cfg.id}Logs`, {
    logGroupName: `/ecs/amu-reporting/${cfg.source}`,
    retention: logs.RetentionDays.ONE_MONTH,
    removalPolicy: cdk.RemovalPolicy.RETAIN,
  });
  // Egress: HTTPS only to the VPC (interface endpoints for ECR, Secrets Manager, KMS, Logs,
  // STS, GuardDuty, all private DNS) and the S3 prefix list (data bucket and ECR layers via the
  // S3 gateway endpoint), plus 1433 to its one host. No general internet egress.
  // Amazon-provided DNS is not filtered by security groups.
  const sg = new ec2.SecurityGroup(scope, `${cfg.id}Sg`, {
    vpc: ctx.vpc,
    description: `AMU reporting ${cfg.source} publisher`,
    allowAllOutbound: false,
  });
  sg.addEgressRule(ec2.Peer.ipv4(ctx.vpc.vpcCidrBlock), ec2.Port.tcp(443), "HTTPS to VPC interface endpoints");
  sg.addEgressRule(ec2.Peer.prefixList(s3PrefixListId), ec2.Port.tcp(443), "HTTPS to S3");
  sg.addEgressRule(ec2.Peer.ipv4(cfg.sqlHost), ec2.Port.tcp(1433), `${cfg.source} SQL Server only`);
  const taskDef = new ecs.FargateTaskDefinition(scope, `${cfg.id}Task`, {
    cpu: 512,
    memoryLimitMiB: cfg.memoryLimitMiB,
    taskRole,
    executionRole,
  });
  sourceSecret.grantRead(executionRole);
  grantGuardDutyAgentPull(executionRole);
  taskDef.addVolume({ name: "tmp" });
  const e = cfg.envPrefix;
  taskDef.addContainer("worker", {
    image: ecs.ContainerImage.fromDockerImageAsset(ctx.workerImage),
    logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: cfg.source }),
    environment: {
      DATA_BUCKET: "amu-reporting-production-reportdatabucket-rncvucke",
      [`${e}_KMS_KEY_ID`]: key.keyArn,
    },
    // Only this source's SQL login. No runtimeSecrets (Slate, Virtuous, auth, etc.).
    secrets: {
      [`${e}_HOST`]: ecs.Secret.fromSecretsManager(sourceSecret, "host"),
      [`${e}_PORT`]: ecs.Secret.fromSecretsManager(sourceSecret, "port"),
      [`${e}_DATABASE`]: ecs.Secret.fromSecretsManager(sourceSecret, "database"),
      [`${e}_USERNAME`]: ecs.Secret.fromSecretsManager(sourceSecret, "username"),
      [`${e}_PASSWORD`]: ecs.Secret.fromSecretsManager(sourceSecret, "password"),
    },
    readonlyRootFilesystem: true,
    user: "reporting",
  }).addMountPoints({ sourceVolume: "tmp", containerPath: "/tmp", readOnly: false });
  new events.Rule(scope, `${cfg.id}Schedule`, {
    enabled: false,
    schedule: events.Schedule.cron(cfg.cron),
    targets: [new targets.EcsTask({
      cluster: ctx.cluster,
      taskDefinition: taskDef,
      taskCount: 1,
      subnetSelection: ctx.ecsPrivateSubnets,
      securityGroups: [sg],
      assignPublicIp: false,
      containerOverrides: [{ containerName: "worker", command: [cfg.source] }],
    })],
  });
  new cdk.CfnOutput(scope, `${cfg.id}SecurityGroupId`, { value: sg.securityGroupId });
  new cdk.CfnOutput(scope, `${cfg.id}TaskDefinitionArn`, { value: taskDef.taskDefinitionArn });
}

// GuardDuty Runtime Monitoring injects its agent sidecar into every Fargate task and
// pulls the image with the task's execution role. The CDK default execution policy only
// allows pulls from this account's asset repo, so the sidecar failed with 403 and the
// tasks ran unmonitored. Allow pulls from the AWS-owned agent repo only.
function grantGuardDutyAgentPull(role: iam.IRole) {
  role.addToPrincipalPolicy(new iam.PolicyStatement({
    actions: ["ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"],
    resources: ["arn:aws:ecr:us-east-2:307168627858:repository/aws-guardduty-agent-fargate"],
  }));
}

function runtimeSecrets(secret: secrets.ISecret, resendSecret: secrets.ISecret, xaiSecret: secrets.ISecret) {
  const keys = ["AUTH_SECRET", "VIRTUOUS_API_KEY", "QLIK_API_KEY", "QLIK_TENANT", "EREZLIFE_API_KEY", "SLATE_QUERY_URL", "SLATE_DEPOSITS_URL", "SLATE_USERNAME", "SLATE_PASSWORD", "INSTITUTE_SLATE_QUERIES", "ALLOWED_EMAILS", "ENROLLMENT_ALLOWED_EMAILS", "HOUSING_ALLOWED_EMAILS", "INSTITUTE_ALLOWED_EMAILS", "MAS_ALLOWED_EMAILS", "POINTS_ALLOWED_EMAILS", "ALUMNI_ALLOWED_EMAILS", "ANNUNCIATION_ALLOWED_EMAILS", "EMAIL_FROM"];
  return {
    ...Object.fromEntries(keys.map((key) => [key, ecs.Secret.fromSecretsManager(secret, key)])),
    // Whole-secret reference, no JSON field selector.
    RESEND_API_KEY: ecs.Secret.fromSecretsManager(resendSecret),
    XAI_API_KEY: ecs.Secret.fromSecretsManager(xaiSecret),
  };
}
