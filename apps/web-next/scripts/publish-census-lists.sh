#!/bin/bash
# Upload student-level census lists (not in git) to the reporting data bucket.
# Requires AWS credentials and the JSON files in src/lib/reports/census/data/.
set -euo pipefail
cd "$(dirname "$0")/.."
BUCKET="${DATA_BUCKET:-amu-reporting-production-reportdatabucket-rncvucke}"
DIR="src/lib/reports/census/data"
aws s3 cp "$DIR/students.json" "s3://$BUCKET/cache/census/students.json" --content-type "application/json"
aws s3 cp "$DIR/unretained.json" "s3://$BUCKET/cache/census/unretained.json" --content-type "application/json"
aws s3 cp "$DIR/prior.json" "s3://$BUCKET/cache/census/prior.json" --content-type "application/json"
aws s3 cp "$DIR/graduates.json" "s3://$BUCKET/cache/census/graduates.json" --content-type "application/json"
if [ -f "$DIR/unretained-enrichment.json" ]; then
  aws s3 cp "$DIR/unretained-enrichment.json" "s3://$BUCKET/cache/census/unretained-enrichment.json" --content-type "application/json"
fi
echo "Published census lists to s3://$BUCKET/cache/census/"
