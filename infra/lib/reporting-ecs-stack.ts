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
const aspireduAllowedEmails = "cole.j.cantu@avemaria.edu,regina.m.pirolli@avemaria.edu,michael.t.middendorf@avemaria.edu";

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
    task.addToTaskRolePolicy(new iam.PolicyStatement({ actions: ["s3:GetObject", "s3:ListBucket"], resources: [dataBucketArn, `${dataBucketArn}/*`] }));
    // Points review flags: the web app persists the shared flag queue to a single
    // object. Scope the write narrowly to just that key (least privilege) — reads
    // are already covered by the GetObject grant above.
    task.addToTaskRolePolicy(new iam.PolicyStatement({ actions: ["s3:PutObject"], resources: [`${dataBucketArn}/points/review-flags.json`] }));
    // Housing verification/uploads: staff xlsx + edit state under cache/housing/.
    task.addToTaskRolePolicy(new iam.PolicyStatement({ actions: ["s3:PutObject"], resources: [`${dataBucketArn}/cache/housing/*`] }));
    // On-demand report Lambdas (Institute/MAS/Alumni) live in the SST runtime; the
    // web app invokes them by name (see /api/institute-data, /api/reports/mas, alumni).
    // The web container needs both the function names AND permission to invoke them.
    const onDemandFns = {
      INSTITUTE_FN_NAME: "amu-reporting-production-InstituteDataFunction-trtxkdvv",
      MAS_PROCESS_FUNCTION: "amu-reporting-production-MasProcessFunction-xzhzvdkw",
      ALUMNI_PROCESS_FUNCTION: "amu-reporting-production-AlumniProcessFunction-vuhfevxd",
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
    task.addContainer("web", { image: ecs.ContainerImage.fromDockerImageAsset(webImage), portMappings: [{ containerPort: 3000 }], logging: ecs.LogDrivers.awsLogs({ logGroup: webLogs, streamPrefix: "web" }), environment: { DATA_BUCKET: "amu-reporting-production-reportdatabucket-rncvucke", APP_BASE_URL: reportingDomainUrl, MAGIC_NONCE_TABLE: magicNonceTableName, ASPIREDU_SESSION_TABLE: aspireduSessionTableName, ASPIREDU_USER_POOL_ID: aspireduUserPool.userPoolId, ASPIREDU_USER_POOL_CLIENT_ID: aspireduClient.userPoolClientId, ASPIREDU_COGNITO_DOMAIN: aspireduDomain.baseUrl(), ASPIREDU_CALLBACK_URL: aspireduCallbackUrl, ASPIREDU_CALLBACK_URLS: [aspireduCallbackUrl, aspireduDomainCallbackUrl].join(","), ASPIREDU_ALLOWED_EMAILS: aspireduAllowedEmails, ...onDemandFns, ...aspireduFns }, secrets: runtimeSecrets(secret, resendSecret), readonlyRootFilesystem: true, user: "node" }).addMountPoints(
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
    worker.addToTaskRolePolicy(new iam.PolicyStatement({ actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"], resources: [dataBucketArn, `${dataBucketArn}/*`] }));
    worker.addVolume({ name: "tmp" });
    worker.addContainer("worker", { image: ecs.ContainerImage.fromDockerImageAsset(workerImage), logging: ecs.LogDrivers.awsLogs({ logGroup: workerLogs, streamPrefix: "worker" }), environment: { DATA_BUCKET: "amu-reporting-production-reportdatabucket-rncvucke" }, secrets: runtimeSecrets(secret, resendSecret), readonlyRootFilesystem: true, user: "reporting" }).addMountPoints(
      { sourceVolume: "tmp", containerPath: "/tmp", readOnly: false },
    );
    for (const [name, schedule, action] of [["Enrollment", events.Schedule.rate(cdk.Duration.minutes(15)), "enrollment"], ["Virtuous", events.Schedule.rate(cdk.Duration.minutes(15)), "virtuous"], ["Housing", events.Schedule.rate(cdk.Duration.hours(6)), "housing"], ["Institute", events.Schedule.rate(cdk.Duration.hours(6)), "institute"]] as const) {
      new events.Rule(this, `${name}Schedule`, { enabled: false, schedule, targets: [new targets.EcsTask({ cluster, taskDefinition: worker, taskCount: 1, subnetSelection: ecsPrivateSubnets, assignPublicIp: false, containerOverrides: [{ containerName: "worker", command: [action] }] })] });
    }
    new cdk.CfnOutput(this, "AspireduUserPoolId", { value: aspireduUserPool.userPoolId });
    new cdk.CfnOutput(this, "AspireduUserPoolClientId", { value: aspireduClient.userPoolClientId });
    new cdk.CfnOutput(this, "AspireduLoginDomain", { value: aspireduDomain.baseUrl() });
  }
}

function runtimeSecrets(secret: secrets.ISecret, resendSecret: secrets.ISecret) {
  const keys = ["AUTH_SECRET", "VIRTUOUS_API_KEY", "QLIK_API_KEY", "QLIK_TENANT", "EREZLIFE_API_KEY", "SLATE_QUERY_URL", "SLATE_DEPOSITS_URL", "INSTITUTE_SLATE_QUERIES", "ALLOWED_EMAILS", "ENROLLMENT_ALLOWED_EMAILS", "HOUSING_ALLOWED_EMAILS", "INSTITUTE_ALLOWED_EMAILS", "MAS_ALLOWED_EMAILS", "POINTS_ALLOWED_EMAILS", "ALUMNI_ALLOWED_EMAILS", "ANNUNCIATION_ALLOWED_EMAILS", "EMAIL_FROM"];
  return {
    ...Object.fromEntries(keys.map((key) => [key, ecs.Secret.fromSecretsManager(secret, key)])),
    // Whole-secret reference, no JSON field selector.
    RESEND_API_KEY: ecs.Secret.fromSecretsManager(resendSecret),
  };
}
