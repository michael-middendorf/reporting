import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import * as path from "node:path";

const account = "905418447941";
const region = "us-east-2";
const dataBucketArn = `arn:aws:s3:::amu-reporting-production-reportdatabucket-rncvucke`;

export class ReportingEcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    const vpc = ec2.Vpc.fromLookup(this, "DefaultVpc", { isDefault: true });
    const cluster = new ecs.Cluster(this, "Cluster", { vpc, clusterName: "amu-reporting" });
    const secret = secrets.Secret.fromSecretNameV2(this, "RuntimeSecret", "amu-reporting/production/runtime");
    const webLogs = new logs.LogGroup(this, "WebLogs", { logGroupName: "/ecs/amu-reporting/web-v2", retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.RETAIN });
    const workerLogs = new logs.LogGroup(this, "WorkerLogs", { logGroupName: "/ecs/amu-reporting/worker-v2", retention: logs.RetentionDays.ONE_MONTH, removalPolicy: cdk.RemovalPolicy.RETAIN });
    const webImage = new ecrAssets.DockerImageAsset(this, "WebImage", { directory: path.join(__dirname, "../.."), file: "Dockerfile.web" });
    const workerImage = new ecrAssets.DockerImageAsset(this, "WorkerImage", { directory: path.join(__dirname, "../.."), file: "Dockerfile.worker" });
    const webSg = new ec2.SecurityGroup(this, "WebSg", { vpc, description: "AMU reporting web tasks", allowAllOutbound: true });
    const task = new ecs.FargateTaskDefinition(this, "WebTask", { cpu: 512, memoryLimitMiB: 1024 });
    secret.grantRead(task.obtainExecutionRole());
    task.addToTaskRolePolicy(new iam.PolicyStatement({ actions: ["s3:GetObject", "s3:ListBucket"], resources: [dataBucketArn, `${dataBucketArn}/*`] }));
    task.addContainer("web", { image: ecs.ContainerImage.fromDockerImageAsset(webImage), portMappings: [{ containerPort: 3000 }], logging: ecs.LogDrivers.awsLogs({ logGroup: webLogs, streamPrefix: "web" }), environment: { DATA_BUCKET: "amu-reporting-production-reportdatabucket-rncvucke", APP_BASE_URL: "https://reporting.avemaria.edu" }, secrets: runtimeSecrets(secret) });
    const service = new ecs.FargateService(this, "WebService", { cluster, taskDefinition: task, desiredCount: 1, assignPublicIp: true, securityGroups: [webSg], vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }, circuitBreaker: { rollback: true }, minHealthyPercent: 100, maxHealthyPercent: 200 });
    const alb = elbv2.ApplicationLoadBalancer.fromApplicationLoadBalancerAttributes(this, "SharedAlb", { loadBalancerArn: `arn:aws:elasticloadbalancing:${region}:${account}:loadbalancer/app/avemaria-alb/57b406e2fc6d6c5c`, securityGroupId: "sg-0c7c300cac7664317", loadBalancerCanonicalHostedZoneId: "Z3AADJGX6KTTL2", loadBalancerDnsName: "avemaria-alb-1775577982.us-east-2.elb.amazonaws.com" });
    webSg.addIngressRule(ec2.Peer.securityGroupId("sg-0c7c300cac7664317"), ec2.Port.tcp(3000), "HTTPS traffic from shared ALB");
    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", { hostedZoneId: "Z05753053I9MN1HSFFBDO", zoneName: "avemaria.edu" });
    const certificate = new acm.Certificate(this, "Certificate", { domainName: "reporting.avemaria.edu", validation: acm.CertificateValidation.fromDns(zone) });
    const tg = new elbv2.ApplicationTargetGroup(this, "WebTargets", { vpc, port: 3000, protocol: elbv2.ApplicationProtocol.HTTP, targetType: elbv2.TargetType.IP, healthCheck: { path: "/api/health" } });
    service.attachToApplicationTargetGroup(tg);
    new elbv2.CfnListenerCertificate(this, "HttpsCertificate", { listenerArn: `arn:aws:elasticloadbalancing:${region}:${account}:listener/app/avemaria-alb/57b406e2fc6d6c5c/4c06c5d24c43202c`, certificates: [{ certificateArn: certificate.certificateArn }] });
    new elbv2.CfnListenerRule(this, "HttpsRule", { listenerArn: `arn:aws:elasticloadbalancing:${region}:${account}:listener/app/avemaria-alb/57b406e2fc6d6c5c/4c06c5d24c43202c`, priority: 25, conditions: [{ field: "host-header", hostHeaderConfig: { values: ["reporting.avemaria.edu"] } }], actions: [{ type: "forward", targetGroupArn: tg.targetGroupArn }] });
    new route53.ARecord(this, "Dns", { zone, recordName: "reporting", target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(alb)) });
    const worker = new ecs.FargateTaskDefinition(this, "WorkerTask", { cpu: 1024, memoryLimitMiB: 3072 });
    secret.grantRead(worker.obtainExecutionRole());
    worker.addToTaskRolePolicy(new iam.PolicyStatement({ actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"], resources: [dataBucketArn, `${dataBucketArn}/*`] }));
    worker.addContainer("worker", { image: ecs.ContainerImage.fromDockerImageAsset(workerImage), logging: ecs.LogDrivers.awsLogs({ logGroup: workerLogs, streamPrefix: "worker" }), environment: { DATA_BUCKET: "amu-reporting-production-reportdatabucket-rncvucke" }, secrets: runtimeSecrets(secret) });
    for (const [name, schedule, action] of [["Enrollment", events.Schedule.rate(cdk.Duration.minutes(15)), "enrollment"], ["Virtuous", events.Schedule.rate(cdk.Duration.minutes(15)), "virtuous"], ["Housing", events.Schedule.rate(cdk.Duration.hours(6)), "housing"], ["Institute", events.Schedule.rate(cdk.Duration.hours(6)), "institute"]] as const) {
      new events.Rule(this, `${name}Schedule`, { enabled: false, schedule, targets: [new targets.EcsTask({ cluster, taskDefinition: worker, taskCount: 1, subnetSelection: { subnetType: ec2.SubnetType.PUBLIC }, assignPublicIp: true, containerOverrides: [{ containerName: "worker", command: [action] }] })] });
    }
    new events.Rule(this, "DailyMagicLinksSchedule", { enabled: false, schedule: events.Schedule.expression("cron(0 12 * * ? *)"), targets: [new targets.EcsTask({ cluster, taskDefinition: worker, taskCount: 1, subnetSelection: { subnetType: ec2.SubnetType.PUBLIC }, assignPublicIp: true, containerOverrides: [{ containerName: "worker", command: ["daily-magic"] }] })] });
  }
}

function runtimeSecrets(secret: secrets.ISecret) {
  const keys = ["AUTH_SECRET", "RESEND_API_KEY", "VIRTUOUS_API_KEY", "QLIK_API_KEY", "QLIK_TENANT", "EREZLIFE_API_KEY", "SLATE_QUERY_URL", "SLATE_DEPOSITS_URL", "INSTITUTE_SLATE_QUERIES", "ALLOWED_EMAILS", "ENROLLMENT_ALLOWED_EMAILS", "HOUSING_ALLOWED_EMAILS", "INSTITUTE_ALLOWED_EMAILS", "MAS_ALLOWED_EMAILS", "POINTS_ALLOWED_EMAILS", "ALUMNI_ALLOWED_EMAILS", "EMAIL_FROM"];
  return Object.fromEntries(keys.map((key) => [key, ecs.Secret.fromSecretsManager(secret, key)]));
}
