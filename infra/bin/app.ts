import * as cdk from "aws-cdk-lib";
import { ReportingEcsStack } from "../lib/reporting-ecs-stack.js";

const app = new cdk.App();
new ReportingEcsStack(app, "AmuReportingEcs", {
  env: { account: "905418447941", region: "us-east-2" },
  description: "AMU Reporting ECS production workload",
  terminationProtection: true,
});
