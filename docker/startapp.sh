#!/bin/sh
set -eu
umask 077
mkdir -p /config/Data /output
cd /opt/cloudsave
# Docker's default seccomp profile blocks Chromium's nested namespace sandbox.
# Electron runs as the base image's unprivileged app user, without privileged mode.
echo "Starting CloudSave as uid=$(id -u), data=/config/Data"
exec ./electron/electron ./container-entry.cjs --no-sandbox --disable-gpu --enable-logging=stderr
