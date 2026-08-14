#!/bin/sh
set -e
# ECS/Fargate empty volumes mounted over an existing path do NOT inherit
# that path's permissions from the image - they come through as a fresh
# mount regardless of what was chmod'd/chown'd at build time. Fix it here,
# after mount, while still root, then drop to the unprivileged user.
chmod 1777 /tmp
exec su-exec reporting python /app/worker-entrypoint.py "$@"
