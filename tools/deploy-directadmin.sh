#!/usr/bin/env bash

set -Eeuo pipefail

: "${DIRECTADMIN_HOST:?DIRECTADMIN_HOST is required}"
: "${DIRECTADMIN_USER:?DIRECTADMIN_USER is required}"
: "${DIRECTADMIN_PASSWORD:?DIRECTADMIN_PASSWORD is required}"
: "${DIRECTADMIN_CA_BUNDLE:?DIRECTADMIN_CA_BUNDLE is required}"
: "${REMOTE_DIR:?REMOTE_DIR is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

CA_FILE="${RUNNER_TEMP}/directadmin-ca-bundle.pem"
REMOTE_PARENT="${REMOTE_DIR%/*}"
STAGING_DIR="${REMOTE_PARENT}/.wuwa-map-release-${GITHUB_SHA}"
ROLLBACK_DIR="${REMOTE_PARENT}/.wuwa-map-rollback"
FAILED_DIR="${REMOTE_PARENT}/.wuwa-map-failed-${GITHUB_SHA}"
ARCHIVE_NAME=".wuwa-map-${GITHUB_SHA}.zip"
ARCHIVE_PATH="${REMOTE_PARENT}/${ARCHIVE_NAME}"
API_BASE="https://${DIRECTADMIN_HOST}:2222/api"
LOCAL_ARCHIVE="wuwa-map-${GITHUB_SHA}.zip"

test -s "${CA_FILE}"
test -f "${LOCAL_ARCHIVE}"

DA_CURL=(
  curl --silent --show-error --cacert "${CA_FILE}"
  --user "${DIRECTADMIN_USER}:${DIRECTADMIN_PASSWORD}"
)

da_request() {
  "${DA_CURL[@]}" --fail-with-body "$@"
}

da_stat_status() {
  local path="$1"
  local query
  query="$(python3 - "${path}" <<'PY'
import sys
import urllib.parse

print(urllib.parse.quote(sys.argv[1], safe=""))
PY
)"
  local status
  status="$("${DA_CURL[@]}" \
    --request GET \
    --output /dev/null \
    --write-out '%{http_code}' \
    "${API_BASE}/filemanager/stat?path=${query}")"
  # DirectAdmin reports a missing file-manager path as 409 FilemanagerOpError.
  if [[ "${status}" == 409 ]]; then
    printf '404\n'
  else
    printf '%s\n' "${status}"
  fi
}

da_remove() {
  local path="$1"
  local trash="${2:-false}"
  local payload
  payload="$(python3 - "${path}" "${trash}" <<'PY'
import json
import sys

print(json.dumps({
    "paths": [sys.argv[1]],
    "trash": sys.argv[2].lower() == "true",
}))
PY
)"
  da_request \
    --request POST \
    --header 'Content-Type: application/json' \
    --data "${payload}" \
    "${API_BASE}/filemanager-actions/remove"
}

da_move() {
  local source="$1"
  local destination="$2"
  local payload
  payload="$(python3 - "${source}" "${destination}" <<'PY'
import json
import sys

print(json.dumps({
    "source": sys.argv[1],
    "destination": sys.argv[2],
    "overwrite": False,
}))
PY
)"
  da_request \
    --request POST \
    --header 'Content-Type: application/json' \
    --data "${payload}" \
    "${API_BASE}/filemanager-actions/move"
}

da_mkdir() {
  local path="$1"
  local payload
  payload="$(python3 - "${path}" <<'PY'
import json
import sys

print(json.dumps({"path": sys.argv[1]}))
PY
)"
  da_request \
    --request POST \
    --header 'Content-Type: application/json' \
    --data "${payload}" \
    "${API_BASE}/filemanager-actions/mkdir"
}

da_extract() {
  local source="$1"
  local destination="$2"
  local payload
  payload="$(python3 - "${source}" "${destination}" <<'PY'
import json
import sys

print(json.dumps({
    "source": sys.argv[1],
    "destinationDir": sys.argv[2],
    "members": [],
    "mergeAndOverwrite": False,
}))
PY
)"
  da_request \
    --request POST \
    --header 'Content-Type: application/json' \
    --data "${payload}" \
    "${API_BASE}/filemanager-actions/extract-archive"
}

da_upload() {
  local directory="$1"
  local name="$2"
  local directory_query
  local name_query
  directory_query="$(python3 - "${directory}" <<'PY'
import sys
import urllib.parse

print(urllib.parse.quote(sys.argv[1], safe=""))
PY
)"
  name_query="$(python3 - "${name}" <<'PY'
import sys
import urllib.parse

print(urllib.parse.quote(sys.argv[1], safe=""))
PY
)"
  da_request \
    --request POST \
    --form "file=@${LOCAL_ARCHIVE};type=application/zip" \
    "${API_BASE}/filemanager-actions/upload?dir=${directory_query}&name=${name_query}&perm=420&overwrite=true"
}

da_chmod_directories() {
  local deploy_dir="$1"
  python3 - "${deploy_dir}" <<'PY'
import json
import os
import sys
from pathlib import Path

deploy_dir = Path(sys.argv[1])
paths = [str(deploy_dir)]
paths.extend(
    str(deploy_dir / path.relative_to("dist"))
    for path in sorted(Path("dist").rglob("*"))
    if path.is_dir()
)
for index in range(0, len(paths), 100):
    Path(f"/tmp/wuwa-map-chmod-{index}.json").write_text(
        json.dumps({"paths": paths[index:index + 100], "perm": 493}),
        encoding="utf-8",
    )
PY
  shopt -s nullglob
  local payload
  for payload in /tmp/wuwa-map-chmod-*.json; do
    da_request \
      --request POST \
      --header 'Content-Type: application/json' \
      --data-binary "@${payload}" \
      "${API_BASE}/filemanager-actions/chmod"
    rm -f "${payload}"
  done
}

public_verify_release() {
  local site='https://accel.io.vn/wuwa-map'
  local origin='https://accel.io.vn'
  local shell
  local app_asset
  local cache_version
  local catalog_json
  local first_pack
  local pack_json

  shell="$(curl --fail --silent --show-error "${site}/?v=${GITHUB_SHA}")"
  app_asset="$(printf '%s' "${shell}" | grep -Eo '/wuwa-map/assets/index-[^" ]+\.js' | head -n 1)"
  test -n "${app_asset}"
  test -f "dist/assets/${app_asset##*/}"
  curl --fail --silent --show-error -o /tmp/wuwa-map-app.js "${origin}${app_asset}"
  test "$(sha256sum "dist/assets/${app_asset##*/}" | cut -d' ' -f1)" = "$(sha256sum /tmp/wuwa-map-app.js | cut -d' ' -f1)"
  curl --fail --silent --show-error -o /tmp/wuwa-map-sw.js "${site}/sw.js?v=${GITHUB_SHA}"
  cmp -s dist/sw.js /tmp/wuwa-map-sw.js
  cache_version="$(sed -nE 's/.*route-switcher-v([0-9]+).*/\1/p' /tmp/wuwa-map-sw.js | head -n 1)"
  test -n "${cache_version}"
  curl --fail --silent --show-error -o /tmp/wuwa-map-catalog.json "${site}/map-packs/private/catalog.json?v=${GITHUB_SHA}"
  cmp -s dist/map-packs/private/catalog.json /tmp/wuwa-map-catalog.json
  catalog_json="$(cat /tmp/wuwa-map-catalog.json)"
  test "$(printf '%s' "${catalog_json}" | jq '.maps | length')" -ge 52
  grep -Fq "route-switcher-v${cache_version}" /tmp/wuwa-map-app.js
  grep -Fq 'map-packs/private/catalog.json' /tmp/wuwa-map-app.js
  grep -Fq 'progressCompatibility' /tmp/wuwa-map-app.js
  printf '%s' "${catalog_json}" | jq -e '
    .schemaVersion == 1 and
    (.maps | length >= 52) and
    (.maps | all(.id and .pack)) and
    (.maps | all((.pack | startswith("map-packs/private/"))))
  ' >/dev/null
  first_pack="$(printf '%s' "${catalog_json}" | jq -r '.maps[0].pack')"
  pack_json="$(curl --fail --silent --show-error "${site}/${first_pack}?v=${GITHUB_SHA}")"
  printf '%s' "${pack_json}" | jq -e '
    .schemaVersion == 1 and
    (.id | type == "string") and
    (.markers | type == "array") and
    (.categories | type == "array")
  ' >/dev/null
  curl --fail --silent --show-error -o /tmp/wuwa-map-tile.webp \
    "${site}/map-packs/private/maps/912/5_-5.webp?v=${GITHUB_SHA}"
  test "$(stat -c '%s' /tmp/wuwa-map-tile.webp)" -gt 0
}

public_verify_rollback() {
  local site='https://accel.io.vn/wuwa-map'
  local shell
  shell="$(curl --fail --silent --show-error "${site}/")"
  printf '%s' "${shell}" | grep -Eq '/wuwa-map/assets/index-[^" ]+\.js'
  curl --fail --silent --show-error "${site}/map-packs/private/catalog.json" | jq -e '.schemaVersion == 1 and (.maps | length >= 52)' >/dev/null
  curl --fail --silent --show-error -o /tmp/wuwa-map-rollback-tile.webp \
    "${site}/map-packs/private/maps/912/5_-5.webp"
  test "$(stat -c '%s' /tmp/wuwa-map-rollback-tile.webp)" -gt 0
}

current_moved=0
release_promoted=0

rollback_on_error() {
  local status="$?"
  trap - ERR
  set +e
  echo "Deployment failed; attempting automatic rollback."
  if [[ "${release_promoted}" == 1 ]]; then
    da_move "${REMOTE_DIR}" "${FAILED_DIR}" || da_remove "${REMOTE_DIR}" true || true
  fi
  if [[ "${current_moved}" == 1 ]]; then
    da_move "${ROLLBACK_DIR}" "${REMOTE_DIR}" || true
    public_verify_rollback || true
  fi
  exit "${status}"
}
trap rollback_on_error ERR

for path in "${STAGING_DIR}" "${FAILED_DIR}" "${ARCHIVE_PATH}"; do
  status="$(da_stat_status "${path}")"
  if [[ "${status}" == 200 ]]; then
    da_remove "${path}" false
  elif [[ "${status}" != 404 ]]; then
    echo "Unexpected DirectAdmin status ${status} for ${path}" >&2
    exit 1
  fi
done

current_status="$(da_stat_status "${REMOTE_DIR}")"
rollback_status="$(da_stat_status "${ROLLBACK_DIR}")"
if [[ "${current_status}" == 404 && "${rollback_status}" == 200 ]]; then
  echo "Recovering production from the previous rollback slot."
  da_move "${ROLLBACK_DIR}" "${REMOTE_DIR}"
  current_status=200
  rollback_status=404
fi
if [[ "${current_status}" != 200 && "${current_status}" != 404 ]]; then
  echo "Unexpected DirectAdmin status ${current_status} for ${REMOTE_DIR}" >&2
  exit 1
fi
da_mkdir "${STAGING_DIR}"
da_upload "${REMOTE_PARENT}" "${ARCHIVE_NAME}"
da_extract "${ARCHIVE_PATH}" "${STAGING_DIR}"
da_chmod_directories "${STAGING_DIR}"
test "$(da_stat_status "${STAGING_DIR}/index.html")" == 200

if [[ "${current_status}" == 200 ]]; then
  if [[ "${rollback_status}" == 200 ]]; then
    da_remove "${ROLLBACK_DIR}" false
  elif [[ "${rollback_status}" != 404 ]]; then
    echo "Unexpected DirectAdmin status ${rollback_status} for ${ROLLBACK_DIR}" >&2
    exit 1
  fi
  da_move "${REMOTE_DIR}" "${ROLLBACK_DIR}"
  current_moved=1
fi
da_move "${STAGING_DIR}" "${REMOTE_DIR}"
release_promoted=1

public_verify_release
if ! da_remove "${ARCHIVE_PATH}" false; then
  echo "Warning: release archive cleanup failed; leaving ${ARCHIVE_PATH}." >&2
fi
trap - ERR
echo "Deployment verified successfully. Previous release is retained at ${ROLLBACK_DIR}."
