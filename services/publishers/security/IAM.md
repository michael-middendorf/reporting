# IAM for the cybersecurity dashboard publisher (IT-3, PR 2)

This publisher (`services/publishers/security`) is read-only against AWS and
GitHub, and writes only to the `cybersecurity/` prefix of the ReportData
bucket. The main loop applies and reviews the actual IAM policy, KMS key
policy, and bucket policy; this file lists exactly what the Lambda execution
role needs so that review has a fixed target instead of a blanket
`*:Describe*`/`*:List*` grant.

No resource name, account id, or live finding count appears below on
purpose: this file documents a role shape every collaborator can read, not
AMU's current security posture.

## Read-only AWS actions

All of the following are read-only (`Describe*`/`Get*`/`List*`/`BatchGet*`).
None of them create, modify, or delete a resource.

| Service | Actions | Resource |
|---|---|---|
| Security Hub | `securityhub:GetEnabledStandards`, `securityhub:GetFindings` | `*` (account/region-scoped by the standard IAM condition keys if the main loop prefers that) |
| GuardDuty | `guardduty:ListDetectors`, `guardduty:GetFindingsStatistics` | `*` |
| Inspector2 | `inspector2:BatchGetAccountStatus`, `inspector2:ListFindings` | `*` |
| IAM credential report | `iam:GenerateCredentialReport`, `iam:GetCredentialReport` | `*` (these two actions do not support resource-level restriction) |
| STS (account id for Inspector2) | `sts:GetCallerIdentity` | `*` |
| CloudTrail | `cloudtrail:DescribeTrails`, `cloudtrail:GetTrailStatus` | `*` |
| AWS Backup | `backup:ListBackupJobs` | `*` |
| RDS | `rds:DescribeDBInstances` | `*` |
| ACM | `acm:ListCertificates`, `acm:DescribeCertificate` | `*` (both regions this publisher calls) |
| EC2 | `ec2:DescribeVpnConnections` | `*` |

Regions: `us-east-2` and `us-east-1` (ACM and the per-region sources loop
both; CloudTrail is called once since multi-region trails are visible from
either region's endpoint).

## S3 (ReportData bucket)

| Action | Resource |
|---|---|
| `s3:GetObject` | `arn:aws:s3:::<ReportData bucket>/cybersecurity/inbox/ad/*` |
| `s3:GetObject` | `arn:aws:s3:::<ReportData bucket>/cybersecurity/history/*` (reads the newest history file to compute deltas) |
| `s3:ListBucket` | `arn:aws:s3:::<ReportData bucket>` (condition: `s3:prefix` starts with `cybersecurity/`) |
| `s3:PutObject` | `arn:aws:s3:::<ReportData bucket>/cybersecurity/latest.json` |
| `s3:PutObject` | `arn:aws:s3:::<ReportData bucket>/cybersecurity/history/*` |

This role must **not** get `s3:PutObject` on `cybersecurity/inbox/ad/*` (that
prefix is written only by the separate AD inbox principal built in PR 4) and
must not get any access to other top-level prefixes in the bucket.

## KMS (cybersecurity CMK)

| Action | Resource |
|---|---|
| `kms:GenerateDataKey` | the cybersecurity-prefix CMK |
| `kms:Decrypt` | the cybersecurity-prefix CMK (needed to read back the AD inbox file and the previous history file) |

No other KMS action (no `kms:CreateKey`, `kms:PutKeyPolicy`,
`kms:ScheduleKeyDeletion`, etc).

## Secrets Manager

| Action | Resource |
|---|---|
| `secretsmanager:GetSecretValue` | the GitHub App secret named by `SECURITY_GITHUB_SECRET` only |
| `secretsmanager:GetSecretValue` | the Graph app secret named by `SECURITY_GRAPH_SECRET` only (PR 3; harmless to grant now since `graph.py` is a stub that never calls it) |

No wildcard Secrets Manager resource, and no `secretsmanager:PutSecretValue`,
`secretsmanager:DeleteSecret`, or `secretsmanager:RotateSecret`.

## Environment variables this role's Lambda needs

| Variable | Purpose |
|---|---|
| `DATA_BUCKET` | ReportData bucket name (same convention as every other publisher) |
| `SECURITY_GITHUB_SECRET` | Secrets Manager id/ARN of the GitHub App secret. Unset means `github.py` reports `not_configured` and never calls Secrets Manager. |
| `SECURITY_GRAPH_SECRET` | Secrets Manager id/ARN of the Graph app secret (PR 3). Unset means `graph.py` reports `not_configured`. |
| `SECURITY_WATCH_RDS_IDS` | Optional, comma-separated `DBInstanceIdentifier`s to count individually for public-exposure tracking. Unset means only the general publicly-accessible count is reported; no identifier is hardcoded in this publisher. |

## What this role does not get

- No write/modify/delete action on any AWS service above.
- No access to any S3 prefix in ReportData other than `cybersecurity/` as
  scoped above.
- No IAM write actions (cannot create/modify users, roles, or policies).
- No GitHub permissions beyond what the GitHub App installation itself
  grants (Dependabot alerts: read, code scanning alerts: read, secret
  scanning alerts: read, metadata: read). This publisher never requests
  write scopes from the App.
