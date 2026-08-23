#!/bin/sh
set -e
# Local docker often starts as root. Fix volume perms, then drop to node.
# ECS Fargate runs this image as task-definition user `node`; bind-mount
# volumes are already owned by that user, and chmod/chown would EPERM.
if [ "$(id -u)" = "0" ]; then
  chmod 1777 /tmp 2>/dev/null || true
  mkdir -p /app/.next/cache
  chown -R node:node /app/.next/cache 2>/dev/null || true
  exec su-exec node node server.js "$@"
fi
exec node server.js "$@"
