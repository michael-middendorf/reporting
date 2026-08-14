#!/bin/sh
set -e
# ECS/Fargate empty volumes mounted over an existing path do NOT inherit
# that path's permissions from the image - they come through as a fresh
# mount regardless of what was chmod'd/chown'd at build time. Fix it here,
# after mount, while still root, then drop to the unprivileged user.
chmod 1777 /tmp
mkdir -p /app/.next/cache
chown -R node:node /app/.next/cache
exec su-exec node node server.js "$@"
