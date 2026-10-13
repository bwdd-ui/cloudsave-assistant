#!/bin/bash
set -euo pipefail
package="$PWD/fnos/cloudsave"
export TRIM_APPDEST="$package/app"
export TRIM_PKGETC="$PWD/fnos-ci/etc"
export TRIM_PKGVAR="$PWD/fnos-ci/var"
export TRIM_DATA_SHARE_PATHS="$PWD/fnos-ci/exports"
export TRIM_TEMP_LOGFILE="$PWD/fnos-ci/error.txt"
export TRIM_SERVICE_PORT=18985
export TRIM_USERNAME="$(id -un)"
export wizard_admin_username=ci_admin
export wizard_admin_password=FnOS-Test_20261013
export CLOUDSAVE_SMOKE_TEST=1
mkdir -p "$TRIM_PKGETC" "$TRIM_PKGVAR/Data" "$TRIM_DATA_SHARE_PATHS" fnos/dist
chmod +x "$package"/cmd/*
for script in "$package"/cmd/*; do bash -n "$script"; done
"$package/cmd/install_init"
# Import from the embedded archive via the real install callback.
"$package/cmd/install_callback"
test "$(stat -c '%a' "$TRIM_PKGETC/web.env")" = 600
initial_hash=$(sha256sum "$TRIM_PKGETC/web.env" | cut -d' ' -f1)
wizard_admin_password=short "$package/cmd/config_callback" >/dev/null 2>&1 && { echo 'Weak password accepted'; exit 1; }
test "$(sha256sum "$TRIM_PKGETC/web.env" | cut -d' ' -f1)" = "$initial_hash"
"$package/cmd/main" start
docker compose -p cloudsave -f "$package/app/docker/docker-compose.yaml" config --quiet
docker compose -p cloudsave -f "$package/app/docker/docker-compose.yaml" up -d
for i in $(seq 1 60); do
  test -f "$TRIM_PKGVAR/docker-smoke.json" && break
  test "$(docker inspect cloudsave-fnos --format '{{.State.Running}}')" = true || { docker logs cloudsave-fnos; exit 1; }
  sleep 2
done
python3 -c 'import json,sys;r=json.load(open(sys.argv[1]));assert r["ok"] and r["uid"]>0 and not r["secondRun"]' "$TRIM_PKGVAR/docker-smoke.json"
"$package/cmd/main" status
curl -fk https://127.0.0.1:18985/ >/dev/null
printf 'persistent-history-marker\n' > "$TRIM_PKGVAR/Data/upgrade-marker.txt"
docker compose -p cloudsave -f "$package/app/docker/docker-compose.yaml" stop
if "$package/cmd/main" status; then echo 'Stopped container incorrectly reported running'; exit 1; else test "$?" = 3; fi
unset wizard_admin_password
"$package/cmd/upgrade_init"
"$package/cmd/upgrade_callback"
test "$(sha256sum "$TRIM_PKGETC/web.env" | cut -d' ' -f1)" = "$initial_hash"
grep -q 'persistent-history-marker' "$TRIM_PKGVAR/Data/upgrade-marker.txt"
export wizard_admin_password=Updated-Test_20261013
"$package/cmd/config_callback"
test "$(sha256sum "$TRIM_PKGETC/web.env" | cut -d' ' -f1)" != "$initial_hash"
rm "$TRIM_PKGVAR/docker-smoke.json"
docker compose -p cloudsave -f "$package/app/docker/docker-compose.yaml" up -d
for i in $(seq 1 60); do
  test -f "$TRIM_PKGVAR/docker-smoke.json" && break
  sleep 2
done
python3 -c 'import json,sys;r=json.load(open(sys.argv[1]));assert r["ok"] and r["secondRun"]' "$TRIM_PKGVAR/docker-smoke.json"
cp "$TRIM_PKGVAR/docker-smoke.json" fnos/dist/fnos-container.json
cp "$TRIM_PKGVAR/docker-smoke.png" fnos/dist/fnos-ui.png
docker compose -p cloudsave -f "$package/app/docker/docker-compose.yaml" stop
docker logs cloudsave-fnos > fnos/dist/fnos-container.log 2>&1
printf '%s\n' '{"simulatedFnOSEnvironment":true,"realDockerRuntime":true,"offlineImageImport":true,"startStopStatus":true,"passwordValidation":true,"upgradePreservedHistory":true,"configChanged":true,"restartCookiePreserved":true,"realFnOSInstallation":false}' > fnos/dist/fnos-lifecycle.json
docker compose -p cloudsave -f "$package/app/docker/docker-compose.yaml" down
