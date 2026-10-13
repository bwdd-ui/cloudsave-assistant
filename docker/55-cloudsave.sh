#!/bin/sh
set -eu
mkdir -p /output
# Compose may create a missing bind directory as root; make its root writable
# by the configured non-root application user without changing existing files.
chown "${USER_ID:-1000}:${GROUP_ID:-1000}" /output
