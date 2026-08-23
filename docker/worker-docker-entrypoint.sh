#!/bin/sh
set -e
# Local docker often starts as root. Fix /tmp perms, then drop to reporting.
# ECS Fargate runs this image as task-definition user `reporting`; bind-mount
# volumes are already owned by that user, and chmod would EPERM.
if [ "$(id -u)" = "0" ]; then
  chmod 1777 /tmp 2>/dev/null || true
  exec su-exec reporting python /app/worker-entrypoint.py "$@"
fi
exec python /app/worker-entrypoint.py "$@"
