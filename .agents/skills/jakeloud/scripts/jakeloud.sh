#!/usr/bin/env bash

set -euo pipefail

PROGRAM=${0##*/}
CONFIG_HOME=${XDG_CONFIG_HOME:-${HOME:?HOME is not set}/.config}
DEFAULT_CONFIG_FILE=$CONFIG_HOME/jakeloud/config.json
CONFIG_FILE=${JAKELOUD_CONFIG:-$DEFAULT_CONFIG_FILE}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<EOF
Usage:
  $PROGRAM configure [--allow-http]
  $PROGRAM projects [--json]
  $PROGRAM status <project> [--json]
  $PROGRAM reboot <project> --yes

Configuration: $CONFIG_FILE
EOF
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

file_mode() {
  stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1" 2>/dev/null || return 1
}

is_local_url() {
  case "$1" in
    http://localhost|http://localhost:*|http://localhost/*|http://127.0.0.1|http://127.0.0.1:*|http://127.0.0.1/*|http://\[::1\]|http://\[::1\]:*|http://\[::1\]/*)
      return 0
      ;;
  esac
  return 1
}

validate_url() {
  local url=$1
  local allow_http=$2
  local authority

  case "$url" in
    https://?*) ;;
    http://?*)
      if [[ "$allow_http" != true ]] && ! is_local_url "$url"; then
        die "HTTP is insecure for remote services; use HTTPS or rerun configure with --allow-http"
      fi
      ;;
    *) die "base URL must begin with https:// or http://" ;;
  esac

  [[ "$url" != *[[:space:]]* ]] || die "base URL must not contain whitespace"
  authority=${url#*://}
  authority=${authority%%/*}
  [[ "$authority" != *@* ]] || die "base URL must not contain embedded credentials"
}

configure() {
  local allow_http=false
  local base_url email password config_dir temp_file

  if [[ ${1:-} == --allow-http ]]; then
    allow_http=true
    shift
  fi
  [[ $# -eq 0 ]] || die "unexpected configure argument: $1"

  require_command jq
  printf 'JakeLoud base URL (for example, https://jl.example.com): ' >&2
  IFS= read -r base_url
  printf 'JakeLoud email: ' >&2
  IFS= read -r email
  printf 'JakeLoud password: ' >&2
  IFS= read -r -s password
  printf '\n' >&2

  base_url=${base_url%/}
  [[ -n "$base_url" ]] || die "base URL is required"
  [[ -n "$email" ]] || die "email is required"
  [[ -n "$password" ]] || die "password is required"
  validate_url "$base_url" "$allow_http"

  config_dir=${CONFIG_FILE%/*}
  if [[ "$config_dir" == "$CONFIG_FILE" ]]; then
    config_dir=.
  fi

  umask 077
  if [[ ! -d "$config_dir" ]]; then
    mkdir -p "$config_dir"
    chmod 700 "$config_dir"
  elif [[ "$CONFIG_FILE" == "$DEFAULT_CONFIG_FILE" ]]; then
    chmod 700 "$config_dir"
  fi
  temp_file=$(mktemp "$config_dir/.config.XXXXXX")
  trap 'rm -f "$temp_file"' EXIT
  jq -n \
    --arg base_url "$base_url" \
    --arg email "$email" \
    --arg password "$password" \
    --argjson allow_http "$allow_http" \
    '{base_url: $base_url, email: $email, password: $password, allow_http: $allow_http}' >"$temp_file"
  chmod 600 "$temp_file"
  mv -f "$temp_file" "$CONFIG_FILE"
  trap - EXIT

  printf 'Configuration saved to %s\n' "$CONFIG_FILE"
}

load_config() {
  local mode allow_http

  [[ -f "$CONFIG_FILE" ]] || die "configuration not found; run '$PROGRAM configure' in your terminal"
  [[ ! -L "$CONFIG_FILE" ]] || die "refusing to read a symlinked configuration file"
  mode=$(file_mode "$CONFIG_FILE") || die "could not verify configuration permissions"
  [[ "$mode" == 600 ]] || die "configuration permissions are $mode; run: chmod 600 '$CONFIG_FILE'"

  jq -e '
    type == "object" and
    (.base_url | type == "string" and length > 0) and
    (.email | type == "string" and length > 0) and
    (.password | type == "string" and length > 0) and
    ((.allow_http // false) | type == "boolean")
  ' "$CONFIG_FILE" >/dev/null 2>&1 || die "configuration is invalid; rerun '$PROGRAM configure'"

  BASE_URL=$(jq -r '.base_url' "$CONFIG_FILE")
  EMAIL=$(jq -r '.email' "$CONFIG_FILE")
  PASSWORD=$(jq -r '.password' "$CONFIG_FILE")
  allow_http=$(jq -r '.allow_http // false' "$CONFIG_FILE")
  BASE_URL=${BASE_URL%/}
  validate_url "$BASE_URL" "$allow_http"
}

api_request() {
  local payload=$1
  local response_file http_code curl_status

  response_file=$(mktemp "${TMPDIR:-/tmp}/jakeloud-response.XXXXXX")
  http_code=$(printf '%s' "$payload" | curl \
    --silent \
    --show-error \
    --output "$response_file" \
    --write-out '%{http_code}' \
    --request POST \
    --header 'Content-Type: application/json' \
    --data-binary @- \
    "$BASE_URL/api") || curl_status=$?

  if [[ ${curl_status:-0} -ne 0 ]]; then
    rm -f "$response_file"
    die "could not connect to $BASE_URL"
  fi
  if [[ ! "$http_code" =~ ^2[0-9][0-9]$ ]]; then
    local message
    message=$(jq -r '.message // empty' "$response_file" 2>/dev/null || true)
    rm -f "$response_file"
    die "JakeLoud API returned HTTP $http_code${message:+: $message}"
  fi

  printf '%s' "$(<"$response_file")"
  rm -f "$response_file"
}

authenticated_response() {
  local response=$1
  local message

  jq -e . >/dev/null 2>&1 <<<"$response" || die "JakeLoud returned an invalid JSON response"
  message=$(jq -r 'if type == "object" then .message // empty else empty end' <<<"$response")
  case "$message" in
    login) die "authentication failed; rerun '$PROGRAM configure'" ;;
    register) die "JakeLoud requires initial registration in its web UI" ;;
  esac
}

projects() {
  local json=false response payload
  if [[ ${1:-} == --json ]]; then
    json=true
    shift
  fi
  [[ $# -eq 0 ]] || die "unexpected projects argument: $1"

  payload=$(jq -n --arg email "$EMAIL" --arg password "$PASSWORD" \
    '{op: "getConfOp", email: $email, password: $password}')
  response=$(api_request "$payload")
  authenticated_response "$response"
  jq -e '.apps | type == "array"' >/dev/null 2>&1 <<<"$response" || die "JakeLoud response does not contain a project list"

  if [[ "$json" == true ]]; then
    jq '[.apps[] | select(.name != "jakeloud") | {
      name,
      domain: (.domain // null),
      repo: (.repo // null),
      port: (.port // null),
      state: (.state // null)
    }]' <<<"$response"
    return
  fi

  printf 'NAME\tSTATE\tDOMAIN\tREPOSITORY\n'
  jq -r '.apps[] | select(.name != "jakeloud") | [.name, (.state // "unknown"), (.domain // "-"), (.repo // "-")] | @tsv' <<<"$response"
}

get_project() {
  local name=$1
  local payload response

  payload=$(jq -n --arg email "$EMAIL" --arg password "$PASSWORD" --arg name "$name" \
    '{op: "getAppOp", email: $email, password: $password, name: $name}')
  response=$(api_request "$payload")
  authenticated_response "$response"
  if [[ $(jq -r '.message // empty' <<<"$response") == "name is undefined" ]]; then
    die "project name is required"
  fi
  jq -e --arg name "$name" 'type == "object" and .name == $name' >/dev/null 2>&1 <<<"$response" || die "project not found: $name"
  printf '%s\n' "$response"
}

status_project() {
  local name=${1:-}
  local json=false response
  [[ -n "$name" ]] || die "project name is required"
  shift
  if [[ ${1:-} == --json ]]; then
    json=true
    shift
  fi
  [[ $# -eq 0 ]] || die "unexpected status argument: $1"

  response=$(get_project "$name")
  if [[ "$json" == true ]]; then
    jq '{
      name,
      domain: (.domain // null),
      repo: (.repo // null),
      port: (.port // null),
      state: (.state // null),
      additional: {
        currentRelease: (.additional.currentRelease // null),
        runtime: (.additional.runtime // null),
        promotionDeadline: (.additional.promotionDeadline // null),
        ps: (.additional.ps // null),
        logs: (.additional.logs // null)
      }
    }' <<<"$response"
    return
  fi

  jq -r '
    "Project: \(.name)",
    "State: \(.state // "unknown")",
    "Domain: \(.domain // "-")",
    "Repository: \(.repo // "-")",
    "Release: \(.additional.currentRelease // "-")",
    "Process: \(.additional.ps // "-")",
    (if .additional.logs then "\nLogs:\n\(.additional.logs)" else empty end)
  ' <<<"$response"
}

reboot_project() {
  local name=${1:-}
  local confirmed=false response payload command
  [[ -n "$name" ]] || die "project name is required"
  shift
  if [[ ${1:-} == --yes ]]; then
    confirmed=true
    shift
  fi
  [[ $# -eq 0 ]] || die "unexpected reboot argument: $1"
  [[ "$confirmed" == true ]] || die "full reboot requires explicit confirmation; rerun with --yes"

  response=$(get_project "$name")
  command=$(jq -r '.additional.cmd // ""' <<<"$response")
  payload=$(jq -n \
    --arg email "$EMAIL" \
    --arg password "$PASSWORD" \
    --arg name "$name" \
    --arg domain "$(jq -r '.domain // ""' <<<"$response")" \
    --arg repo "$(jq -r '.repo // ""' <<<"$response")" \
    --arg command "$command" \
    '{op: "createAppOp", email: $email, password: $password, name: $name, domain: $domain, repo: $repo, additional: {cmd: $command}}')
  api_request "$payload" >/dev/null
  printf 'Full reboot started for %s\n' "$name"
}

main() {
  local command=${1:-}
  if [[ -z "$command" || "$command" == --help || "$command" == -h ]]; then
    usage
    [[ -n "$command" ]] && exit 0 || exit 1
  fi
  shift

  case "$command" in
    configure)
      configure "$@"
      ;;
    projects|status|reboot)
      require_command curl
      require_command jq
      load_config
      case "$command" in
        projects) projects "$@" ;;
        status) status_project "$@" ;;
        reboot) reboot_project "$@" ;;
      esac
      ;;
    *)
      usage >&2
      die "unknown command: $command"
      ;;
  esac
}

main "$@"
