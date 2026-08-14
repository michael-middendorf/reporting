import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
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

export class ReportingEcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const vpc = ec2.Vpc.fromLookup(this, "DefaultVpc", { isDefault: true });
    const cluster = new ecs.Cluster(this, "Cluster", { vpc, clusterName: "amu-reporting" });
    // avemaria-alb only has AZ mappings for us-east-2a and us-east-2b (no us-east-2c).
    // The web service must stay pinned to these two subnets - the default PUBLIC
    // subnet selection includes a third, us-east-2c, subnet whose tasks can never
    // register healthy in the ALB target group (AZ not enabled for the load balancer),
    // and can trip the deployment circuit breaker / a full stack rollback.
    const albSubnets = {
      subnets: [
        ec2.Subnet.fromSubnetAttributes(this, "AlbSubnetA", { subnetId: "subnet-0faac786118924240", availabilityZone: "us-east-2a", routeTableId: "rtb-0ae97e2a9ebb643dd" }),
        ec2.Subnet.fromSubnetAttributes(this, "AlbSubnetB", { subnetId: "subnet-037e01d5bdd3c6fcd", availabilityZone: "us-east-2b", routeTableId: "rtb-0ae97e2a9ebb643dd" }),
      ],
    };
    const secret = secrets.Secret.fromSecretNameV2(this, "RuntimeSecret", "amu-reporting/production/runtime");
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
    task.addVolume({ name: "tmp" });
    task.addVolume({ name: "next-cache" });
    task.addContainer("web", { image: ecs.ContainerImage.fromDockerImageAsset(webImage), portMappings: [{ containerPort: 3000 }], logging: ecs.LogDrivers.awsLogs({ logGroup: webLogs, streamPrefix: "web" }), environment: { DATA_BUCKET: "amu-reporting-production-reportdatabucket-rncvucke", APP_BASE_URL: reportingUrl, ...onDemandFns }, secrets: runtimeSecrets(secret), readonlyRootFilesystem: true }).addMountPoints(
      { sourceVolume: "tmp", containerPath: "/tmp", readOnly: false },
      { sourceVolume: "next-cache", containerPath: "/app/.next/cache", readOnly: false },
    );
    const service = new ecs.FargateService(this, "WebService", { cluster, taskDefinition: task, desiredCount: 1, assignPublicIp: true, securityGroups: [webSg], vpcSubnets: albSubnets, circuitBreaker: { rollback: true }, minHealthyPercent: 100, maxHealthyPercent: 200 });
    webSg.addIngressRule(ec2.Peer.securityGroupId("sg-0c7c300cac7664317"), ec2.Port.tcp(3000), "HTTPS traffic from shared ALB");
    const tg = new elbv2.ApplicationTargetGroup(this, "WebTargets", { vpc, port: 3000, protocol: elbv2.ApplicationProtocol.HTTP, targetType: elbv2.TargetType.IP, healthCheck: { path: "/api/health" } });
    service.attachToApplicationTargetGroup(tg);
    new elbv2.CfnListenerRule(this, "TemporaryCloudFrontRule", { listenerArn: `arn:aws:elasticloadbalancing:${region}:${account}:listener/app/avemaria-alb/57b406e2fc6d6c5c/2292cb613158c683`, priority: 35, conditions: [{ field: "http-header", httpHeaderConfig: { httpHeaderName: reportingOriginHeaderName, values: [reportingOriginHeaderValue] } }], actions: [{ type: "forward", targetGroupArn: tg.targetGroupArn }] });
    const worker = new ecs.FargateTaskDefinition(this, "WorkerTask", { cpu: 1024, memoryLimitMiB: 3072 });
    secret.grantRead(worker.obtainExecutionRole());
    worker.addToTaskRolePolicy(new iam.PolicyStatement({ actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"], resources: [dataBucketArn, `${dataBucketArn}/*`] }));
    worker.addVolume({ name: "tmp" });
    worker.addContainer("worker", { image: ecs.ContainerImage.fromDockerImageAsset(workerImage), logging: ecs.LogDrivers.awsLogs({ logGroup: workerLogs, streamPrefix: "worker" }), environment: { DATA_BUCKET: "amu-reporting-production-reportdatabucket-rncvucke" }, secrets: runtimeSecrets(secret), readonlyRootFilesystem: true }).addMountPoints(
      { sourceVolume: "tmp", containerPath: "/tmp", readOnly: false },
    );
    for (const [name, schedule, action] of [["Enrollment", events.Schedule.rate(cdk.Duration.minutes(15)), "enrollment"], ["Virtuous", events.Schedule.rate(cdk.Duration.minutes(15)), "virtuous"], ["Housing", events.Schedule.rate(cdk.Duration.hours(6)), "housing"], ["Institute", events.Schedule.rate(cdk.Duration.hours(6)), "institute"]] as const) {
      new events.Rule(this, `${name}Schedule`, { enabled: false, schedule, targets: [new targets.EcsTask({ cluster, taskDefinition: worker, taskCount: 1, subnetSelection: { subnetType: ec2.SubnetType.PUBLIC }, assignPublicIp: true, containerOverrides: [{ containerName: "worker", command: [action] }] })] });
    }
    new events.Rule(this, "DailyMagicLinksSchedule", { enabled: false, schedule: events.Schedule.expression("cron(0 12 * * ? *)"), targets: [new targets.EcsTask({ cluster, taskDefinition: worker, taskCount: 1, subnetSelection: { subnetType: ec2.SubnetType.PUBLIC }, assignPublicIp: true, containerOverrides: [{ containerName: "worker", command: ["daily-magic"] }] })] });
  }
}

function runtimeSecrets(secret: secrets.ISecret) {
  const keys = ["AUTH_SECRET", "RESEND_API_KEY", "VIRTUOUS_API_KEY", "QLIK_API_KEY", "QLIK_TENANT", "EREZLIFE_API_KEY", "SLATE_QUERY_URL", "SLATE_DEPOSITS_URL", "INSTITUTE_SLATE_QUERIES", "ALLOWED_EMAILS", "ENROLLMENT_ALLOWED_EMAILS", "HOUSING_ALLOWED_EMAILS", "INSTITUTE_ALLOWED_EMAILS", "MAS_ALLOWED_EMAILS", "POINTS_ALLOWED_EMAILS", "ALUMNI_ALLOWED_EMAILS", "ANNUNCIATION_ALLOWED_EMAILS", "EMAIL_FROM"];
  return Object.fromEntries(keys.map((key) => [key, ecs.Secret.fromSecretsManager(secret, key)]));
}
