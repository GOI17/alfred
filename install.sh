#!/bin/sh
# Alfred suite installer. Local-first, preview-first, no harness writes by default.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --edition=full --name=acme --apply
#   curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --component=profile-manager --name=acme
#
# Safety:
#   - Without --apply this prints an install plan only and writes no files.
#   - Without advanced flags and with a TTY, this opens an app-like guided TUI.
#   - It never installs Pi/opencode/Codex live harness config by default.
#   - Unknown flags fail closed instead of being ignored.

set -e

VERSION="0.4.1.1"
REPO_URL="https://github.com/GOI17/alfred.git"
DEFAULT_BRANCH="main"
NODE_MIN="22"
INSTALLER_DIR=""
case "$0" in
  */*) INSTALLER_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)" || INSTALLER_DIR="" ;;
esac

EDITION="coding"
NAME="default"
TARGET_PATH=""
HARNESS="auto"
HARNESS_STATUS=""
SELECTED_HARNESSES=""
APPLY=false
NO_CLONE=false
COMPONENTS=""
PROFILE_STRATEGY="runtime-profiles"
MEMORY_SETUP="not-selected"
SKIP_PROFILE_MANAGER=false
HAD_ARGS=false
TUI_USED=false
TUI_MODE="none"
MODEL_STRATEGY="configure-later"
MODEL_WRITE_APPROVED=false
MODEL_PLAN_SHA256=""
MODEL_CONFIG_WRITTEN=false
CATALOG_TRACE_AGGREGATE='{"consent":"not-decided","outcome":"not-requested","bytes_bucket":"none","provider_count_bucket":"none","model_count_bucket":"none","duration_bucket":"none","catalog_metadata_requests":0}'

log() { printf '[alfred-install] %s\n' "$*"; }
err() { printf '[alfred-install][error] %s\n' "$*" 1>&2; exit 1; }

usage() {
  sed -n '2,36p' "$0"
  cat <<'USAGE'

Flags:
  --edition=<coding|memory|full>  Suite edition to plan/install. Default: coding.
  --component=<id>                Install one component. Repeatable. Overrides edition list in the plan.
  --name=<name>                   Human-readable install/context name. Default: default.
  --path=<dir>                    Install repo path when --apply is used. Default: ~/.alfred/installs/<name>.
  --harness=<auto|opencode|codex-cli|codex-app|codex|pi|none>
                                  Harness previews. Comma-repeatable. auto selects installed supported harnesses.
  --apply                         Apply safe suite install steps. Without this, preview only.
  --dry-run                       Alias for preview-only mode.
  --no-clone                      With --apply, reuse an existing repo at --path.
  --help                          Show help.

Examples:
  install.sh
  install.sh --edition=coding --name=acme
  install.sh --edition=coding --name=acme --harness=opencode,codex-cli --apply
  install.sh --component=profile-manager --name=work-laptop
USAGE
}

append_component() {
  if [ -z "$COMPONENTS" ]; then
    COMPONENTS="$1"
  else
    COMPONENTS="$COMPONENTS,$1"
  fi
}

append_csv_unique() {
  current="$1"
  item="$2"
  case ",$current," in
    *",$item,"*) printf '%s' "$current" ;;
    ",,") printf '%s' "$item" ;;
    *) printf '%s,%s' "$current" "$item" ;;
  esac
}

harness_installed() {
  case "$1" in
    opencode)
      [ -d ".opencode" ] || command -v opencode >/dev/null 2>&1
      ;;
    codex-cli)
      command -v codex >/dev/null 2>&1
      ;;
    codex-app)
      [ -d "/Applications/Codex.app" ] || [ -d "$HOME/Applications/Codex.app" ] || [ -n "${CODEX_APP_HOME:-}" ]
      ;;
    pi)
      command -v pi >/dev/null 2>&1 || [ -d "$HOME/.pi" ]
      ;;
    *)
      return 1
      ;;
  esac
}

detect_harness_status() {
  result=""
  for id in opencode codex-cli codex-app pi; do
    if harness_installed "$id"; then
      state="installed"
    else
      state="not-installed"
    fi
    result="$(append_csv_unique "$result" "$id=$state")"
  done
  printf '%s' "$result"
}

installed_harnesses_from_status() {
  result=""
  old_ifs="$IFS"
  IFS=","
  for entry in $HARNESS_STATUS; do
    IFS="$old_ifs"
    id="${entry%%=*}"
    state="${entry#*=}"
    if [ "$state" = "installed" ]; then
      result="$(append_csv_unique "$result" "$id")"
    fi
    IFS=","
  done
  IFS="$old_ifs"
  if [ -z "$result" ]; then
    result="none"
  fi
  printf '%s' "$result"
}

normalize_harness_selection() {
  input="$1"
  if [ "$input" = "auto" ]; then
    installed_harnesses_from_status
    return 0
  fi
  result=""
  normalized="$(printf '%s' "$input" | tr '+ ' ',,')"
  old_ifs="$IFS"
  IFS=","
  for raw in $normalized; do
    IFS="$old_ifs"
    case "$raw" in
      "" ) ;;
      none|decide-later) result="$(append_csv_unique "$result" "none")" ;;
      opencode) result="$(append_csv_unique "$result" "opencode")" ;;
      codex) result="$(append_csv_unique "$result" "codex-cli")"; result="$(append_csv_unique "$result" "codex-app")" ;;
      codex-cli) result="$(append_csv_unique "$result" "codex-cli")" ;;
      codex-app) result="$(append_csv_unique "$result" "codex-app")" ;;
      pi) result="$(append_csv_unique "$result" "pi")" ;;
      auto)
        installed="$(installed_harnesses_from_status)"
        old_ifs_auto="$IFS"
        IFS=","
        for installed_id in $installed; do
          IFS="$old_ifs_auto"
          result="$(append_csv_unique "$result" "$installed_id")"
          IFS=","
        done
        IFS="$old_ifs_auto"
        ;;
      *) err "Unknown harness: $raw (use auto, opencode, codex-cli, codex-app, pi, or none)" ;;
    esac
    IFS=","
  done
  IFS="$old_ifs"
  if [ -z "$result" ]; then
    result="none"
  fi
  case ",$result," in
    *,none,*)
      if [ "$result" != "none" ]; then
        err "--harness cannot combine none with other harnesses"
      fi
      ;;
  esac
  printf '%s' "$result"
}

display_harness_status() {
  output=""
  old_ifs="$IFS"
  IFS=","
  for entry in $HARNESS_STATUS; do
    IFS="$old_ifs"
    id="${entry%%=*}"
    state="${entry#*=}"
    if [ -z "$output" ]; then
      output="$id [$state]"
    else
      output="$output, $id [$state]"
    fi
    IFS=","
  done
  IFS="$old_ifs"
  printf '%s' "$output"
}

contains_harness() {
  case ",$SELECTED_HARNESSES," in
    *",$1,"*) return 0 ;;
    *) return 1 ;;
  esac
}

if [ "$#" -gt 0 ]; then
  HAD_ARGS=true
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --edition=*) EDITION="${1#*=}"; shift ;;
    --edition) [ "$#" -ge 2 ] || err "Missing value after --edition"; EDITION="$2"; shift 2 ;;
    --component=*) append_component "${1#*=}"; shift ;;
    --component) [ "$#" -ge 2 ] || err "Missing value after --component"; append_component "$2"; shift 2 ;;
    --name=*) NAME="${1#*=}"; shift ;;
    --name) [ "$#" -ge 2 ] || err "Missing value after --name"; NAME="$2"; shift 2 ;;
    --path=*) TARGET_PATH="${1#*=}"; shift ;;
    --path) [ "$#" -ge 2 ] || err "Missing value after --path"; TARGET_PATH="$2"; shift 2 ;;
    --harness=*) HARNESS="${1#*=}"; shift ;;
    --harness) [ "$#" -ge 2 ] || err "Missing value after --harness"; HARNESS="$2"; shift 2 ;;
    --apply) APPLY=true; shift ;;
    --dry-run) APPLY=false; shift ;;
    --no-clone) NO_CLONE=true; shift ;;
    --profile|--profile=*) err "--profile is legacy and no longer selects the Alfred suite install shape. Use --edition=coding, --edition=memory, or --edition=full." ;;
    --start-server|--registry|--registry=*|--cwd|--cwd=*|--db-connection|--db-connection=*)
      err "$1 belongs to the old Memory-only installer flow. Use --edition=memory after the suite installer lands, or run the memory CLI from an installed Alfred repo."
      ;;
    --help|-h) usage; exit 0 ;;
    --*) err "Unknown flag: $1 (use --help)" ;;
    *) err "Unexpected positional argument: $1 (use --path=<dir> for install path)" ;;
  esac
done

HARNESS_STATUS="$(detect_harness_status)"
SOURCE_PROJECT_PATH="$(pwd -P 2>/dev/null || pwd)"
SOURCE_WORKSPACE_ROOT="$SOURCE_PROJECT_PATH"
CANONICAL_PROJECT_ROOT="$SOURCE_PROJECT_PATH"
GIT_AVAILABILITY="not-installed"
GIT_REPOSITORY_STATE="not-repository"
GIT_LINKED_WORKTREE_STATE="not-applicable"

resolve_invoking_project_root() {
  command -v git >/dev/null 2>&1 || return 0
  GIT_AVAILABILITY="installed"
  workspace_root="$(git -C "$SOURCE_PROJECT_PATH" rev-parse --show-toplevel 2>/dev/null)" || return 0
  [ -n "$workspace_root" ] || return 0
  SOURCE_WORKSPACE_ROOT="$workspace_root"
  GIT_REPOSITORY_STATE="repository"
  git_dir="$(git -C "$SOURCE_PROJECT_PATH" rev-parse --path-format=absolute --git-dir 2>/dev/null || git -C "$SOURCE_PROJECT_PATH" rev-parse --absolute-git-dir 2>/dev/null || true)"
  common_dir="$(git -C "$SOURCE_PROJECT_PATH" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
  if [ -z "$common_dir" ]; then
    common_dir="$(git -C "$SOURCE_PROJECT_PATH" rev-parse --git-common-dir 2>/dev/null || true)"
    case "$common_dir" in
      /*) ;;
      "") common_dir="$git_dir" ;;
      *) common_dir="$SOURCE_WORKSPACE_ROOT/$common_dir" ;;
    esac
  fi
  if [ -n "$common_dir" ] && [ "$(basename "$common_dir")" = ".git" ]; then
    CANONICAL_PROJECT_ROOT="$(cd "$(dirname "$common_dir")" 2>/dev/null && pwd -P)" || CANONICAL_PROJECT_ROOT="$SOURCE_WORKSPACE_ROOT"
  else
    CANONICAL_PROJECT_ROOT="$SOURCE_WORKSPACE_ROOT"
  fi
  if [ -n "$git_dir" ] && [ -n "$common_dir" ] && [ "$git_dir" != "$common_dir" ]; then
    GIT_LINKED_WORKTREE_STATE="linked-worktree"
  else
    GIT_LINKED_WORKTREE_STATE="main-worktree"
  fi
}

resolve_invoking_project_root

has_dev_tty() {
  { : < /dev/tty > /dev/tty; } 2>/dev/null
}

tui_ask() {
  prompt="$1"
  default_value="$2"
  if [ -n "${ALFRED_INSTALL_TUI_INPUT:-}" ]; then
    answer="$(printf '%s\n' "$ALFRED_INSTALL_TUI_INPUT" | sed -n "${ALFRED_INSTALL_TUI_LINE:-1}p")"
    ALFRED_INSTALL_TUI_LINE=$(( ${ALFRED_INSTALL_TUI_LINE:-1} + 1 ))
    export ALFRED_INSTALL_TUI_LINE
    printf '%s%s\n' "$prompt" "$answer" 1>&2
  elif has_dev_tty; then
    printf '%s' "$prompt" > /dev/tty
    IFS= read -r answer < /dev/tty || answer=""
  else
    answer=""
  fi
  if [ -z "$answer" ]; then
    TUI_ANSWER="$default_value"
  else
    TUI_ANSWER="$answer"
  fi
}


print_tui_header() {
  cat <<'EOFTUI'
==============================================================
ALFRED HUMAN-FIRST INSTALLER
==============================================================
Guided, preview-first, and safe to exit before anything is written.
EOFTUI
}

APP_TUI_PRIVATE_DIR=""
APP_MODEL_PLAN_FILE=""
APP_CATALOG_EVENTS_FILE=""

cleanup_app_tui_private_dir() {
  if [ -n "$APP_TUI_PRIVATE_DIR" ] && [ -d "$APP_TUI_PRIVATE_DIR" ]; then
    rm -rf "$APP_TUI_PRIVATE_DIR"
  fi
  APP_TUI_PRIVATE_DIR=""
  APP_MODEL_PLAN_FILE=""
  APP_CATALOG_EVENTS_FILE=""
}

validate_commit_sha() {
  [ "${#1}" -eq 40 ] || return 1
  case "$1" in
    *[!0123456789abcdefABCDEF]*) return 1 ;;
  esac
}

resolve_remote_default_branch_sha() {
  branch_metadata_file="$1"
  if ! curl -fsSL "https://api.github.com/repos/GOI17/alfred/git/ref/heads/$DEFAULT_BRANCH" -o "$branch_metadata_file" 2>/dev/null; then
    return 1
  fi
  chmod 0600 "$branch_metadata_file" || return 1
  resolved_sha="$(node --input-type=module - "$branch_metadata_file" 2>/dev/null <<'NODERESOLVE'
import fs from "node:fs";
const metadata = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (metadata?.object?.type !== "commit" || typeof metadata.object.sha !== "string") process.exit(1);
process.stdout.write(metadata.object.sha);
NODERESOLVE
)" || return 1
  validate_commit_sha "$resolved_sha" || return 1
  printf '%s' "$resolved_sha"
}

reset_app_tui_cleanup_traps() {
  trap - EXIT HUP INT TERM
}

validate_app_tui_quoted_value() {
  quoted_value="$1"
  case "$quoted_value" in
    \'*\') ;;
    *) return 1 ;;
  esac
  quoted_inner=${quoted_value#\'}
  quoted_inner=${quoted_inner%\'}
  safe_apostrophe="'\\''"
  carriage_return="$(printf '\r')"
  while [ -n "$quoted_inner" ]; do
    case "$quoted_inner" in
      "$safe_apostrophe"*) quoted_inner=${quoted_inner#"$safe_apostrophe"} ;;
      *)
        first_character=${quoted_inner%"${quoted_inner#?}"}
        case "$first_character" in
          "'"|"$carriage_return") return 1 ;;
        esac
        quoted_inner=${quoted_inner#?}
        ;;
    esac
  done
}

validate_app_tui_result() {
  result_file="$1"
  seen_keys=""
  while IFS= read -r result_line || [ -n "$result_line" ]; do
    [ -n "$result_line" ] || continue
    result_key=${result_line%%=*}
    result_value=${result_line#*=}
    case "$result_key" in
      EDITION|HARNESS|PROFILE_STRATEGY|MEMORY_SETUP|NAME|APPLY|SKIP_PROFILE_MANAGER|TUI_USED|TUI_MODE|TARGET_PATH|MODEL_STRATEGY|MODEL_WRITE_APPROVED|MODEL_PLAN_SHA256) ;;
      *) return 1 ;;
    esac
    case ",$seen_keys," in
      *",$result_key,"*) return 1 ;;
    esac
    validate_app_tui_quoted_value "$result_value" || return 1
    if [ -z "$seen_keys" ]; then seen_keys="$result_key"; else seen_keys="$seen_keys,$result_key"; fi
  done < "$result_file"
  for required_key in EDITION HARNESS PROFILE_STRATEGY MEMORY_SETUP NAME APPLY SKIP_PROFILE_MANAGER TUI_USED TUI_MODE; do
    case ",$seen_keys," in
      *",$required_key,"*) ;;
      *) return 1 ;;
    esac
  done
}

validate_catalog_events() {
  catalog_events_file="$1"
  node --input-type=module - "$catalog_events_file" 2>/dev/null <<'NODECATALOG'
import fs from "node:fs";
import path from "node:path";

const target = path.resolve(process.argv[2]);
if (path.basename(target) !== "catalog-events.jsonl") process.exit(1);
const parent = path.dirname(target);
const effectiveUid = typeof process.geteuid === "function" ? process.geteuid() : null;
const parentStats = fs.lstatSync(parent);
const pathStats = fs.lstatSync(target);
if (!parentStats.isDirectory() || parentStats.isSymbolicLink() || (parentStats.mode & 0o777) !== 0o700) process.exit(1);
if (!pathStats.isFile() || pathStats.isSymbolicLink() || (pathStats.mode & 0o777) !== 0o600 || pathStats.size > 8192) process.exit(1);
if (effectiveUid !== null && (parentStats.uid !== effectiveUid || pathStats.uid !== effectiveUid)) process.exit(1);
const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
let descriptor;
let text;
try {
  descriptor = fs.openSync(target, fs.constants.O_RDONLY | noFollow);
  const opened = fs.fstatSync(descriptor);
  if (!opened.isFile() || (opened.mode & 0o777) !== 0o600 || opened.dev !== pathStats.dev || opened.ino !== pathStats.ino) process.exit(1);
  if (effectiveUid !== null && opened.uid !== effectiveUid) process.exit(1);
  text = fs.readFileSync(descriptor, "utf8");
} finally {
  if (descriptor !== undefined) fs.closeSync(descriptor);
}
if (text && !text.endsWith("\n")) process.exit(1);
const lines = text ? text.slice(0, -1).split("\n") : [];
const maxDeclines = 6;
const maxEvents = maxDeclines + 2;
if (lines.length > maxEvents || lines.some((line) => Buffer.byteLength(line) > 1024 || !line)) process.exit(1);
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
const outcomes = new Set(["success", "timeout", "aborted", "aborted-before-request", "network", "http", "redirect", "content-type", "oversized", "malformed", "schema"]);
const bytes = new Set(["none", "under-64k", "64k-1m", "1m-4m", "4m-8m"]);
const counts = new Set(["none", "1-10", "11-100", "101-1000", "1001-plus"]);
const durations = new Set(["none", "under-100ms", "100-499ms", "500-999ms", "1-5s", "over-5s"]);
let state = "initial";
let consent = "not-decided";
let fetchEvent = null;
let declineCount = 0;
for (const line of lines) {
  let event;
  try { event = JSON.parse(line); } catch { process.exit(1); }
  if (JSON.stringify(event) !== line) process.exit(1);
  if (event.event === "catalog_consent_decided") {
    if (!exactKeys(event, ["event", "consent"]) || !["allowed", "declined"].includes(event.consent)) process.exit(1);
    if (event.consent === "declined") {
      if (!["initial", "declined"].includes(state) || ++declineCount > maxDeclines) process.exit(1);
      consent = "declined";
      state = "declined";
      continue;
    }
    if (!["initial", "declined"].includes(state)) process.exit(1);
    consent = "allowed";
    state = "allowed";
    continue;
  }
  if (state !== "allowed" || !exactKeys(event, ["event", "outcome", "bytes_bucket", "provider_count_bucket", "model_count_bucket", "duration_bucket", "catalog_metadata_requests"]) || event.event !== "catalog_fetch_completed") process.exit(1);
  const expectedMetadataRequests = event.outcome === "aborted-before-request" ? 0 : 1;
  if (!outcomes.has(event.outcome) || !bytes.has(event.bytes_bucket) || !counts.has(event.provider_count_bucket) || !counts.has(event.model_count_bucket) || !durations.has(event.duration_bucket) || event.catalog_metadata_requests !== expectedMetadataRequests) process.exit(1);
  fetchEvent = event;
  state = "completed";
}
if (state === "allowed") process.exit(1);
const aggregate = {
  consent,
  outcome: fetchEvent?.outcome ?? "not-requested",
  bytes_bucket: fetchEvent?.bytes_bucket ?? "none",
  provider_count_bucket: fetchEvent?.provider_count_bucket ?? "none",
  model_count_bucket: fetchEvent?.model_count_bucket ?? "none",
  duration_bucket: fetchEvent?.duration_bucket ?? "none",
  catalog_metadata_requests: fetchEvent?.catalog_metadata_requests ?? 0
};
process.stdout.write(JSON.stringify(aggregate));
NODECATALOG
}

run_app_tui_if_available() {
  if [ "$HAD_ARGS" = true ] && [ "${ALFRED_INSTALL_FORCE_TUI:-}" != "1" ]; then
    return 1
  fi
  if [ "${ALFRED_INSTALL_FORCE_TUI:-}" != "1" ] && ! has_dev_tty; then
    return 1
  fi
  command -v node >/dev/null 2>&1 || return 1

  app_tui_source_dir=""
  app_tui_remote=false
  if [ -n "$INSTALLER_DIR" ] && [ -f "$INSTALLER_DIR/scripts/tui/install-app.mjs" ]; then
    app_tui_source_dir="$INSTALLER_DIR"
  elif [ -f "./scripts/tui/install-app.mjs" ]; then
    app_tui_source_dir="."
  else
    command -v curl >/dev/null 2>&1 || return 1
    app_tui_remote=true
  fi

  APP_TUI_PRIVATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/alfred-install-app-tui.XXXXXX")" || return 1
  chmod 0700 "$APP_TUI_PRIVATE_DIR" || { cleanup_app_tui_private_dir; return 1; }
  APP_MODEL_PLAN_FILE="$APP_TUI_PRIVATE_DIR/model-plan.json"
  if ! (umask 077; : > "$APP_MODEL_PLAN_FILE") || ! chmod 0600 "$APP_MODEL_PLAN_FILE"; then
    cleanup_app_tui_private_dir
    return 1
  fi
  APP_CATALOG_EVENTS_FILE="$APP_TUI_PRIVATE_DIR/catalog-events.jsonl"
  if ! (umask 077; : > "$APP_CATALOG_EVENTS_FILE") || ! chmod 0600 "$APP_CATALOG_EVENTS_FILE"; then
    cleanup_app_tui_private_dir
    return 1
  fi
  trap 'cleanup_app_tui_private_dir' EXIT
  trap 'cleanup_app_tui_private_dir; exit 129' HUP
  trap 'cleanup_app_tui_private_dir; exit 130' INT
  trap 'cleanup_app_tui_private_dir; exit 143' TERM

  app_tui_script="$APP_TUI_PRIVATE_DIR/install-app.mjs"
  if [ "$app_tui_remote" = true ]; then
    command -v tar >/dev/null 2>&1 || { cleanup_app_tui_private_dir; reset_app_tui_cleanup_traps; return 1; }
    app_tui_branch_metadata="$APP_TUI_PRIVATE_DIR/default-branch.json"
    app_tui_commit_sha="$(resolve_remote_default_branch_sha "$app_tui_branch_metadata")" || {
      cleanup_app_tui_private_dir
      reset_app_tui_cleanup_traps
      return 1
    }
    rm -f "$app_tui_branch_metadata"
    app_tui_snapshot="$APP_TUI_PRIVATE_DIR/alfred-snapshot.tar.gz"
    app_tui_snapshot_dir="$APP_TUI_PRIVATE_DIR/snapshot"
    mkdir "$app_tui_snapshot_dir" || { cleanup_app_tui_private_dir; reset_app_tui_cleanup_traps; return 1; }
    if ! curl -fsSL "https://codeload.github.com/GOI17/alfred/tar.gz/$app_tui_commit_sha" -o "$app_tui_snapshot" 2>/dev/null || \
      ! tar -xzf "$app_tui_snapshot" -C "$app_tui_snapshot_dir" --strip-components=1 2>/dev/null || \
      ! cp "$app_tui_snapshot_dir/scripts/tui/install-app.mjs" "$app_tui_script" || \
      ! cp "$app_tui_snapshot_dir/scripts/tui/install-pathfinder.mjs" "$APP_TUI_PRIVATE_DIR/install-pathfinder.mjs" || \
      ! cp "$app_tui_snapshot_dir/scripts/tui/models-dev-catalog.mjs" "$APP_TUI_PRIVATE_DIR/models-dev-catalog.mjs" || \
      ! cp "$app_tui_snapshot_dir/scripts/tui/install-discovery.mjs" "$APP_TUI_PRIVATE_DIR/install-discovery.mjs" || \
      ! cp "$app_tui_snapshot_dir/packages/profile-manager/src/index.js" "$APP_TUI_PRIVATE_DIR/profile-manager.mjs" || \
      ! cp "$app_tui_snapshot_dir/packages/core/src/model-assignment.js" "$APP_TUI_PRIVATE_DIR/model-assignment.mjs"
    then
      cleanup_app_tui_private_dir
      reset_app_tui_cleanup_traps
      return 1
    fi
    rm -rf "$app_tui_snapshot_dir" "$app_tui_snapshot"
  else
    if ! cp "$app_tui_source_dir/scripts/tui/install-app.mjs" "$app_tui_script" || \
      ! cp "$app_tui_source_dir/scripts/tui/install-pathfinder.mjs" "$APP_TUI_PRIVATE_DIR/install-pathfinder.mjs" || \
      ! cp "$app_tui_source_dir/scripts/tui/models-dev-catalog.mjs" "$APP_TUI_PRIVATE_DIR/models-dev-catalog.mjs" || \
      ! cp "$app_tui_source_dir/scripts/tui/install-discovery.mjs" "$APP_TUI_PRIVATE_DIR/install-discovery.mjs" || \
      ! cp "$app_tui_source_dir/packages/profile-manager/src/index.js" "$APP_TUI_PRIVATE_DIR/profile-manager.mjs" || \
      ! cp "$app_tui_source_dir/packages/core/src/model-assignment.js" "$APP_TUI_PRIVATE_DIR/model-assignment.mjs"
    then
      cleanup_app_tui_private_dir
      reset_app_tui_cleanup_traps
      return 1
    fi
  fi

  chmod 0600 "$app_tui_script" "$APP_TUI_PRIVATE_DIR/install-pathfinder.mjs" \
    "$APP_TUI_PRIVATE_DIR/models-dev-catalog.mjs" "$APP_TUI_PRIVATE_DIR/install-discovery.mjs" "$APP_TUI_PRIVATE_DIR/profile-manager.mjs" \
    "$APP_TUI_PRIVATE_DIR/model-assignment.mjs" || {
      cleanup_app_tui_private_dir
      reset_app_tui_cleanup_traps
      return 1
    }

  app_discovery_file="$APP_TUI_PRIVATE_DIR/discovery.json"
  discovery_target="$TARGET_PATH"
  if [ -z "$discovery_target" ]; then discovery_target="$HOME/.alfred/installs/$NAME"; fi
  if ! (umask 077; ALFRED_INSTALL_TARGET_PATH="$discovery_target" \
    ALFRED_INSTALL_NAME="$NAME" \
    ALFRED_INSTALL_NODE_MIN="$NODE_MIN" \
    ALFRED_INSTALL_SOURCE_WORKSPACE_PATH="$SOURCE_PROJECT_PATH" \
    ALFRED_INSTALL_WORKSPACE_ROOT="$SOURCE_WORKSPACE_ROOT" \
    ALFRED_INSTALL_PROJECT_ROOT="$CANONICAL_PROJECT_ROOT" \
    ALFRED_INSTALL_GIT_AVAILABILITY="$GIT_AVAILABILITY" \
    ALFRED_INSTALL_GIT_REPOSITORY_STATE="$GIT_REPOSITORY_STATE" \
    ALFRED_INSTALL_GIT_WORKTREE_STATE="$GIT_LINKED_WORKTREE_STATE" \
    node "$APP_TUI_PRIVATE_DIR/install-discovery.mjs" > "$app_discovery_file")
  then
    cleanup_app_tui_private_dir
    reset_app_tui_cleanup_traps
    return 1
  fi
  chmod 0600 "$app_discovery_file" || {
    cleanup_app_tui_private_dir
    reset_app_tui_cleanup_traps
    return 1
  }

  app_tui_out="$APP_TUI_PRIVATE_DIR/result.env"
  app_tui_status=1
  if [ -n "${ALFRED_INSTALL_APP_TUI_EVENTS:-}${ALFRED_INSTALL_APP_TUI_SCRIPT:-}" ]; then
    if ALFRED_INSTALL_CURRENT_EDITION="$EDITION" \
      ALFRED_INSTALL_CURRENT_HARNESS="$HARNESS" \
      ALFRED_INSTALL_CURRENT_PROFILE="$PROFILE_STRATEGY" \
      ALFRED_INSTALL_CURRENT_MEMORY="$MEMORY_SETUP" \
      ALFRED_INSTALL_CURRENT_NAME="$NAME" \
      ALFRED_INSTALL_CURRENT_PATH="$TARGET_PATH" \
      ALFRED_INSTALL_CURRENT_APPLY="$APPLY" \
      ALFRED_INSTALL_HARNESS_STATUS="$HARNESS_STATUS" \
      ALFRED_INSTALL_DISCOVERY_FILE="$app_discovery_file" \
      ALFRED_INSTALL_MODEL_PLAN_FILE="$APP_MODEL_PLAN_FILE" \
      ALFRED_INSTALL_CATALOG_EVENTS_FILE="$APP_CATALOG_EVENTS_FILE" \
      node "$app_tui_script" > "$app_tui_out"
    then
      app_tui_status=0
    else
      app_tui_status=$?
    fi
  elif has_dev_tty; then
    if ALFRED_INSTALL_CURRENT_EDITION="$EDITION" \
      ALFRED_INSTALL_CURRENT_HARNESS="$HARNESS" \
      ALFRED_INSTALL_CURRENT_PROFILE="$PROFILE_STRATEGY" \
      ALFRED_INSTALL_CURRENT_MEMORY="$MEMORY_SETUP" \
      ALFRED_INSTALL_CURRENT_NAME="$NAME" \
      ALFRED_INSTALL_CURRENT_PATH="$TARGET_PATH" \
      ALFRED_INSTALL_CURRENT_APPLY="$APPLY" \
      ALFRED_INSTALL_HARNESS_STATUS="$HARNESS_STATUS" \
      ALFRED_INSTALL_DISCOVERY_FILE="$app_discovery_file" \
      ALFRED_INSTALL_MODEL_PLAN_FILE="$APP_MODEL_PLAN_FILE" \
      ALFRED_INSTALL_CATALOG_EVENTS_FILE="$APP_CATALOG_EVENTS_FILE" \
      ALFRED_INSTALL_APP_TUI_RESULT_FILE="$app_tui_out" \
      node "$app_tui_script" < /dev/tty > /dev/tty
    then
      app_tui_status=0
    else
      app_tui_status=$?
    fi
  else
    if ALFRED_INSTALL_CURRENT_EDITION="$EDITION" \
      ALFRED_INSTALL_CURRENT_HARNESS="$HARNESS" \
      ALFRED_INSTALL_CURRENT_PROFILE="$PROFILE_STRATEGY" \
      ALFRED_INSTALL_CURRENT_MEMORY="$MEMORY_SETUP" \
      ALFRED_INSTALL_CURRENT_NAME="$NAME" \
      ALFRED_INSTALL_CURRENT_PATH="$TARGET_PATH" \
      ALFRED_INSTALL_CURRENT_APPLY="$APPLY" \
      ALFRED_INSTALL_HARNESS_STATUS="$HARNESS_STATUS" \
      ALFRED_INSTALL_DISCOVERY_FILE="$app_discovery_file" \
      ALFRED_INSTALL_MODEL_PLAN_FILE="$APP_MODEL_PLAN_FILE" \
      ALFRED_INSTALL_CATALOG_EVENTS_FILE="$APP_CATALOG_EVENTS_FILE" \
      node "$app_tui_script" > "$app_tui_out"
    then
      app_tui_status=0
    else
      app_tui_status=$?
    fi
  fi
  if [ "$app_tui_status" -ge 128 ]; then
    cleanup_app_tui_private_dir
    reset_app_tui_cleanup_traps
    return "$app_tui_status"
  fi
  if catalog_aggregate="$(validate_catalog_events "$APP_CATALOG_EVENTS_FILE")"; then
    CATALOG_TRACE_AGGREGATE="$catalog_aggregate"
  else
    cleanup_app_tui_private_dir
    reset_app_tui_cleanup_traps
    err "Rejected unsafe catalog event trace"
  fi
  if [ "$app_tui_status" -eq 0 ] && [ -s "$app_tui_out" ]; then
    if ! validate_app_tui_result "$app_tui_out"; then
      log "Rejected unsafe app TUI result; falling back to the text installer." 1>&2
      cleanup_app_tui_private_dir
      reset_app_tui_cleanup_traps
      return 1
    fi
    # shellcheck disable=SC1090
    . "$app_tui_out" || {
      cleanup_app_tui_private_dir
      reset_app_tui_cleanup_traps
      return 1
    }
    return 0
  fi
  cleanup_app_tui_private_dir
  reset_app_tui_cleanup_traps
  return 1
}

tui_choose_edition() {
  cat <<'EOFEDITION'

Choose an edition:
  1) coding  (recommended for agent work)
     Core, agents, skills, runtime profiles, adapters, evals. No Memory DB.
  2) memory
     Alfred Memory, API/MCP/OpenAPI, console, and external AI adapters.
  3) full
     Complete Alfred operations suite: coding + Memory together.
EOFEDITION
  tui_ask 'Edition [1=coding, 2=memory, 3=full, default 1]: ' '1'
  choice="$TUI_ANSWER"
  case "$choice" in
    1|coding) EDITION="coding" ;;
    2|memory) EDITION="memory" ;;
    3|full) EDITION="full" ;;
    *) err "Unknown TUI edition choice: $choice" ;;
  esac
}

detected_harness_reason() {
  if [ -d ".opencode" ] || command -v opencode >/dev/null 2>&1; then
    printf 'opencode detected from .opencode/ or opencode on PATH'
    return 0
  fi
  if [ -d ".codex" ] || [ -d ".agents" ] || [ -n "${CODEX_HOME:-}" ]; then
    printf 'Codex detected from .codex/.agents or CODEX_HOME'
    return 0
  fi
  printf 'no harness detected; choose none to decide later'
}

map_tui_harness_choices() {
  input="$1"
  result=""
  normalized="$(printf '%s' "$input" | tr '+| ' ',,,')"
  old_ifs="$IFS"
  IFS=","
  for raw in $normalized; do
    IFS="$old_ifs"
    case "$raw" in
      "" ) ;;
      1|auto) result="$(append_csv_unique "$result" "auto")" ;;
      2|opencode) result="$(append_csv_unique "$result" "opencode")" ;;
      3|codex) result="$(append_csv_unique "$result" "codex")" ;;
      4|pi) result="$(append_csv_unique "$result" "pi")" ;;
      5|none|decide-later) result="$(append_csv_unique "$result" "none")" ;;
      *) err "Unknown TUI harness choice: $raw" ;;
    esac
    IFS=","
  done
  IFS="$old_ifs"
  if [ -z "$result" ]; then
    result="auto"
  fi
  printf '%s' "$result"
}

tui_choose_harness() {
  reason="$(detected_harness_reason)"
  cat <<EOFHARNESS

Choose a harness target:
  1) auto
     Select all installed supported harnesses. Current signal: $reason.
  2) opencode
     For opencode projects; generates opencode previews only.
  3) codex
     For Codex CLI/App custom agents/skills; generates Codex previews.
  4) pi
     For Pi targets; live Pi config is still never written by default.
  5) none / decide later
     Plan the suite without harness-specific previews.

You can select more than one with commas, for example: 2,3 for opencode + Codex.
Detected: $(display_harness_status)
EOFHARNESS
  tui_ask 'Harnesses [1=auto, 2=opencode, 3=codex, 4=pi, 5=none; comma-separated, default 1]: ' '1'
  choice="$TUI_ANSWER"
  HARNESS="$(map_tui_harness_choices "$choice")"
}

tui_choose_name() {
  cat <<'EOFNAME'

Choose a name:
  --name is a local human-readable install/context identifier.
  It labels traces and derives the default path: ~/.alfred/installs/<name>
Examples: acme, work-laptop, personal, client-alpha
EOFNAME
  tui_ask 'Name [default acme]: ' 'acme'
  NAME="$TUI_ANSWER"
}

tui_choose_profile_strategy() {
  case "$EDITION" in
    coding|full) ;;
    *) PROFILE_STRATEGY="not-needed-for-memory-edition"; return 0 ;;
  esac
  cat <<'EOFPROFILE'

Choose a runtime profile strategy:
  1) runtime profiles (recommended)
     Use shared defaults plus machine-private overlays for PATH/provider/model/plugin drift.
  2) decide later
     Skip profile initialization and configure harnesses manually later.
EOFPROFILE
  tui_ask 'Profile strategy [1=runtime profiles, 2=decide later, default 1]: ' '1'
  choice="$TUI_ANSWER"
  case "$choice" in
    1|runtime|runtime-profiles) PROFILE_STRATEGY="runtime-profiles"; SKIP_PROFILE_MANAGER=false ;;
    2|later|none|decide-later) PROFILE_STRATEGY="decide-later"; SKIP_PROFILE_MANAGER=true ;;
    *) err "Unknown TUI profile strategy choice: $choice" ;;
  esac
}

tui_choose_memory_setup() {
  case "$EDITION" in
    memory|full) ;;
    *) MEMORY_SETUP="not-needed-for-coding-edition"; return 0 ;;
  esac
  cat <<'EOFMEMORY'

Choose a Memory setup strategy:
  1) decide later (recommended for first install)
     Plan/install without choosing storage yet.
  2) local SQLite
     Good for coding-agent-only local development on one machine.
  3) Postgres
     Required for human/web agents, external AI shared memory, or multiple machines.
EOFMEMORY
  tui_ask 'Memory setup [1=decide later, 2=local SQLite, 3=Postgres, default 1]: ' '1'
  choice="$TUI_ANSWER"
  case "$choice" in
    1|later|decide-later) MEMORY_SETUP="decide-later" ;;
    2|sqlite|local|local-sqlite) MEMORY_SETUP="local-sqlite" ;;
    3|postgres|pg) MEMORY_SETUP="postgres" ;;
    *) err "Unknown TUI Memory setup choice: $choice" ;;
  esac
}

tui_confirm_apply() {
  cat <<'EOFAPPLY'

Safety choice:
  Preview mode writes no files and is the safest first run.
  Apply can clone/reuse the repo and initialize local profile folders.
  Live harness config is still not written by default.
EOFAPPLY
  tui_ask 'Apply safe suite install steps now? [y/N]: ' 'n'
  choice="$TUI_ANSWER"
  case "$choice" in
    y|Y|yes|YES) APPLY=true ;;
    *) APPLY=false ;;
  esac
}

handoff_ask() {
  prompt="$1"
  default_value="$2"
  if [ -n "${ALFRED_INSTALL_HANDOFF_INPUT:-}" ]; then
    answer="$ALFRED_INSTALL_HANDOFF_INPUT"
    printf '%s%s\n' "$prompt" "$answer" 1>&2
  elif has_dev_tty; then
    printf '%s' "$prompt" > /dev/tty
    IFS= read -r answer < /dev/tty || answer=""
  else
    answer=""
  fi
  if [ -z "$answer" ]; then
    HANDOFF_ANSWER="$default_value"
  else
    HANDOFF_ANSWER="$answer"
  fi
}

run_tui_if_available() {
  if [ "$HAD_ARGS" = true ] && [ "${ALFRED_INSTALL_FORCE_TUI:-}" != "1" ]; then
    return 0
  fi
  if [ "${ALFRED_INSTALL_FORCE_TUI:-}" != "1" ] && ! has_dev_tty; then
    return 0
  fi
  TUI_USED=true
  TUI_MODE="text"
  print_tui_header
  tui_choose_edition
  tui_choose_harness
  tui_choose_profile_strategy
  tui_choose_memory_setup
  tui_choose_name
  tui_confirm_apply
}

if run_app_tui_if_available; then
  :
else
  app_tui_launch_status=$?
  if [ "$app_tui_launch_status" -ge 128 ]; then
    exit "$app_tui_launch_status"
  fi
  log "App TUI unavailable or failed to launch; using text installer." 1>&2
  run_tui_if_available
fi

case "$MODEL_STRATEGY" in
  smart-defaults|custom-models|keep-existing|configure-later) ;;
  *) err "Invalid MODEL_STRATEGY from app TUI: $MODEL_STRATEGY" ;;
esac
case "$MODEL_WRITE_APPROVED" in
  true|false) ;;
  *) err "Invalid MODEL_WRITE_APPROVED from app TUI: $MODEL_WRITE_APPROVED" ;;
esac
for boolean_value in "$APPLY" "$SKIP_PROFILE_MANAGER" "$TUI_USED"; do
  case "$boolean_value" in true|false) ;; *) err "Invalid boolean assignment from app TUI" ;; esac
done
if [ "$MODEL_WRITE_APPROVED" = true ] && { [ "$TUI_MODE" != "app" ] || { [ "$MODEL_STRATEGY" != "smart-defaults" ] && [ "$MODEL_STRATEGY" != "custom-models" ]; } || [ "$APPLY" != true ]; }; then
  err "Model write approval requires app Review, a writable model strategy, and explicit Apply confirmation"
fi
if [ -n "$MODEL_PLAN_SHA256" ]; then
  if [ "${#MODEL_PLAN_SHA256}" -ne 64 ]; then err "Invalid MODEL_PLAN_SHA256 from app TUI: expected 64 lowercase hex characters"; fi
  case "$MODEL_PLAN_SHA256" in *[!0123456789abcdef]*) err "Invalid MODEL_PLAN_SHA256 from app TUI: expected 64 lowercase hex characters" ;; esac
  if [ "$TUI_MODE" != "app" ] || [ "$MODEL_STRATEGY" != "custom-models" ] || [ "$MODEL_WRITE_APPROVED" != true ] || [ "$APPLY" != true ]; then
    err "Unexpected MODEL_PLAN_SHA256 without an approved custom model apply"
  fi
elif [ "$TUI_MODE" = "app" ] && [ "$MODEL_STRATEGY" = "custom-models" ] && [ "$MODEL_WRITE_APPROVED" = true ] && [ "$APPLY" = true ]; then
  err "MODEL_PLAN_SHA256 is required for an approved custom model apply"
fi

case "$EDITION" in
  coding|memory|full) ;;
  *) err "Unknown edition: $EDITION (use coding, memory, or full)" ;;
esac

SELECTED_HARNESSES="$(normalize_harness_selection "$HARNESS")"

case "$NAME" in
  ""|*/*|*\\*|*..*) err "--name must be a simple identifier, got: $NAME" ;;
esac

if [ -z "$TARGET_PATH" ]; then
  TARGET_PATH="$HOME/.alfred/installs/$NAME"
fi

case "$TARGET_PATH" in
  ""|"/") err "Install path cannot be empty or root" ;;
  *"/.ai"|*"/.ai/"*|*"/.opencode"|*"/.opencode/"*|*"/harnesses"|*"/harnesses/"*)
    err "Install path contains a protected segment (.ai, .opencode, harnesses): $TARGET_PATH"
    ;;
esac

node_status="missing"
node_major=""
if command -v node >/dev/null 2>&1; then
  node_version="$(node -v 2>/dev/null || true)"
  node_major="$(printf '%s' "$node_version" | sed -E 's/^v([0-9]+).*/\1/')"
  if [ "$node_major" -ge "$NODE_MIN" ] 2>/dev/null; then
    node_status="ok:$node_version"
  else
    node_status="too_old:$node_version"
  fi
fi

print_model_assignment_preview() {
  case "$MODEL_STRATEGY" in
    smart-defaults)
      printf '\nProposed model configuration (local discovery only):\n'
      if [ -n "$APP_TUI_PRIVATE_DIR" ] && [ -f "$APP_TUI_PRIVATE_DIR/discovery.json" ]; then
        node --input-type=module - "$APP_TUI_PRIVATE_DIR/discovery.json" <<'NODEPREVIEW'
import fs from "node:fs";
const discovery = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.stdout.write(`${JSON.stringify(discovery.models?.proposed_config ?? {}, null, 2)}\n`);
NODEPREVIEW
      else
        printf '  unavailable; configure models later\n'
      fi
      printf 'Proposed target: %s/.alfred/models.json\n' "$HOME"
      printf 'Write approved: %s\n' "$MODEL_WRITE_APPROVED"
      ;;
    custom-models)
      printf '\nCustom model configuration: exact values were reviewed in the app TUI.\n'
      printf 'Proposed target: %s/.alfred/models.json\n' "$HOME"
      printf 'Write approved: %s\n' "$MODEL_WRITE_APPROVED"
      ;;
    keep-existing)
      printf '\nModel configuration: existing ~/.alfred/models.json remains untouched and was not read into the TUI.\n'
      ;;
    configure-later)
      printf '\nModel configuration: configure later; no model configuration will be written.\n'
      ;;
  esac
  printf 'Model provider calls: 0\n'
}

write_approved_model_assignment() {
  [ "$TUI_USED" = true ] || return 0
  [ "$TUI_MODE" = "app" ] || return 0
  [ "$APPLY" = true ] || return 0
  { [ "$MODEL_STRATEGY" = "smart-defaults" ] || [ "$MODEL_STRATEGY" = "custom-models" ]; } || return 0
  [ "$MODEL_WRITE_APPROVED" = true ] || return 0
  [ -n "$APP_TUI_PRIVATE_DIR" ] && [ -f "$APP_TUI_PRIVATE_DIR/discovery.json" ] && [ -f "$APP_TUI_PRIVATE_DIR/model-assignment.mjs" ] || \
    err "Approved model configuration is unavailable"

  model_target="$HOME/.alfred/models.json"
  model_trace="$HOME/.alfred/observability/model-assignment-trace.json"
  mkdir -p "$(dirname "$model_target")" "$(dirname "$model_trace")"
  node --input-type=module - "$MODEL_STRATEGY" "$APP_TUI_PRIVATE_DIR" "$APP_MODEL_PLAN_FILE" "$APP_TUI_PRIVATE_DIR/discovery.json" "$APP_TUI_PRIVATE_DIR/model-assignment.mjs" "$model_target" "$model_trace" "$MODEL_PLAN_SHA256" <<'NODEWRITE'
import fs from "node:fs";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";

const [strategy, privateDir, planPath, discoveryPath, modulePath, targetPath, tracePath, expectedDigest] = process.argv.slice(2);
const { traceModelAssignmentConfigured, validateModelsConfig } = await import(pathToFileURL(modulePath).href);
const effectiveUid = typeof process.geteuid === "function" ? process.geteuid() : null;
let config;
let detectedModels = [];
if (strategy === "custom-models") {
  if (!/^[0-9a-f]{64}$/.test(expectedDigest)) throw new Error("invalid expected custom model plan digest");
  const expectedPrivateDir = path.resolve(privateDir);
  const expectedPlanPath = path.join(expectedPrivateDir, "model-plan.json");
  if (path.resolve(planPath) !== expectedPlanPath || path.dirname(expectedPlanPath) !== expectedPrivateDir || path.basename(expectedPlanPath) !== "model-plan.json") throw new Error("custom model plan must use the fixed private parent and name");
  const privateStats = fs.lstatSync(expectedPrivateDir);
  if (!privateStats.isDirectory() || privateStats.isSymbolicLink() || (privateStats.mode & 0o777) !== 0o700) throw new Error("invalid app TUI private directory mode or type");
  if (effectiveUid !== null && privateStats.uid !== effectiveUid) throw new Error("app TUI private directory is not owned by the effective uid");
  const pathStats = fs.lstatSync(expectedPlanPath);
  if (!pathStats.isFile() || pathStats.isSymbolicLink() || (pathStats.mode & 0o777) !== 0o600) throw new Error("custom model plan must be a mode-0600 regular non-symlink file");
  if (effectiveUid !== null && pathStats.uid !== effectiveUid) throw new Error("custom model plan is not owned by the effective uid");
  const noFollow = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
  let planDescriptor;
  let planBytes;
  try {
    planDescriptor = fs.openSync(expectedPlanPath, fs.constants.O_RDONLY | noFollow);
    const openedStats = fs.fstatSync(planDescriptor);
    if (!openedStats.isFile() || (openedStats.mode & 0o777) !== 0o600) throw new Error("opened custom model plan is not a mode-0600 regular file");
    if (effectiveUid !== null && openedStats.uid !== effectiveUid) throw new Error("opened custom model plan is not owned by the effective uid");
    if (openedStats.dev !== pathStats.dev || openedStats.ino !== pathStats.ino) throw new Error("custom model plan changed before open");
    planBytes = fs.readFileSync(planDescriptor);
  } finally {
    if (planDescriptor !== undefined) fs.closeSync(planDescriptor);
  }
  const actualDigest = createHash("sha256").update(planBytes).digest();
  const expectedDigestBytes = Buffer.from(expectedDigest, "hex");
  if (actualDigest.length !== expectedDigestBytes.length || !timingSafeEqual(actualDigest, expectedDigestBytes)) throw new Error("custom model plan digest mismatch");
  const plan = JSON.parse(planBytes.toString("utf8"));
  const exactKeys = (value, allowed) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => allowed.includes(key));
  if (!exactKeys(plan, ["schema", "strategy", "models", "provider_calls"]) || Object.keys(plan).length !== 4 || plan.schema !== "alfred.install.model-plan/v1" || plan.strategy !== "custom-models" || plan.provider_calls !== 0) throw new Error("invalid custom model plan contract");
  if (!exactKeys(plan.models, ["*", "orchestrator", "developer", "fallbacks"]) || !Object.hasOwn(plan.models, "*") || !Object.hasOwn(plan.models, "fallbacks")) throw new Error("invalid custom models keys");
  for (const key of ["*", "orchestrator", "developer"]) {
    if (!Object.hasOwn(plan.models, key)) continue;
    const entry = plan.models[key];
    if (!exactKeys(entry, ["primary"]) || Object.keys(entry).length !== 1 || typeof entry.primary !== "string" || !entry.primary.trim() || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(entry.primary)) throw new Error(`invalid ${key} model entry`);
  }
  if (!Array.isArray(plan.models.fallbacks) || plan.models.fallbacks.some((value) => typeof value !== "string" || !value.trim() || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value))) throw new Error("invalid custom fallback chain");
  config = plan.models;
} else if (strategy === "smart-defaults") {
  if (expectedDigest) throw new Error("smart defaults cannot carry a custom plan digest");
  const discovery = JSON.parse(fs.readFileSync(discoveryPath, "utf8"));
  if (discovery.schema !== "alfred.install.discovery/v1" || discovery.provider_calls !== 0) throw new Error("invalid discovery contract");
  config = discovery.models?.proposed_config;
  detectedModels = discovery.models?.suggestions ?? [];
} else {
  throw new Error("invalid writable model strategy");
}
const validation = validateModelsConfig(config);
if (validation.status !== "pass" || !config?.["*"]?.primary) throw new Error(`invalid proposed model config: ${validation.errors.join("; ")}`);

function writeAtomic(filePath, text) {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporaryPath, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, text, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    const directoryDescriptor = fs.openSync(path.dirname(filePath), fs.constants.O_RDONLY);
    try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
  } catch (error) {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch {}
    try { fs.unlinkSync(temporaryPath); } catch {}
    throw error;
  }
}

writeAtomic(targetPath, `${JSON.stringify(config, null, 2)}\n`);
const configured = traceModelAssignmentConfigured({
  targetPath,
  detectedModels,
  modelCount: config.fallbacks?.length ?? 0,
  action: "write"
});
const avoided = {
  trace_id: "install-model-provider-request-avoided",
  timestamp: new Date().toISOString(),
  event: "provider_request_avoided",
  actor: "alfred-suite-install",
  data: { operation: "model_assignment_configuration", reason: "local_discovery_sufficient", provider_calls: 0 }
};
writeAtomic(tracePath, `${JSON.stringify({ trace_events: [configured, avoided], provider_calls: 0 }, null, 2)}\n`);
NODEWRITE
  MODEL_CONFIG_WRITTEN=true
  log "Wrote approved model assignment config atomically: $model_target"
  log "Trace events: model_assignment_configured, provider_request_avoided (provider_calls=0)"
}

edition_components() {
  if [ -n "$COMPONENTS" ]; then
    printf '%s' "$COMPONENTS"
    return 0
  fi
  case "$EDITION:$SKIP_PROFILE_MANAGER" in
    coding:true) printf 'core,agents,skills,opencode-adapter,codex-adapter,evals' ;;
    coding:*) printf 'core,agents,skills,profile-manager,opencode-adapter,codex-adapter,evals' ;;
    memory:*) printf 'memory,memory-server,memory-client,memory-mcp,memory-openapi,chatgpt-adapter,anthropic-adapter,gemini-adapter,console,console-web' ;;
    full:true) printf 'core,agents,skills,opencode-adapter,codex-adapter,evals,memory,memory-server,memory-client,memory-mcp,memory-openapi,chatgpt-adapter,anthropic-adapter,gemini-adapter,console,console-web' ;;
    full:*) printf 'core,agents,skills,profile-manager,opencode-adapter,codex-adapter,evals,memory,memory-server,memory-client,memory-mcp,memory-openapi,chatgpt-adapter,anthropic-adapter,gemini-adapter,console,console-web' ;;
  esac
}

COMPONENT_PLAN="$(edition_components)"

DISPLAY_PROFILE_STRATEGY="$PROFILE_STRATEGY"
DISPLAY_MEMORY_SETUP="$MEMORY_SETUP"
if [ "$PROFILE_STRATEGY" = "not-needed-for-memory-edition" ]; then DISPLAY_PROFILE_STRATEGY="Not included in Memory edition"; fi
if [ "$MEMORY_SETUP" = "not-needed-for-coding-edition" ]; then DISPLAY_MEMORY_SETUP="Not included in Coding edition"; fi

print_expected_preview_locations() {
  if [ "$SELECTED_HARNESSES" = "none" ]; then
    printf '  - none selected; no harness preview directories expected\n'
    return 0
  fi
  if contains_harness opencode; then
    printf '  - opencode preview: %s/.ai/generated/opencode-install\n' "$TARGET_PATH"
  fi
  if contains_harness codex-cli || contains_harness codex-app; then
    printf '  - shared Codex preview: %s/.ai/generated/codex-install\n' "$TARGET_PATH"
  fi
  if contains_harness codex-cli; then
    printf '  - Codex CLI preview: %s/.ai/generated/codex-cli-install\n' "$TARGET_PATH"
  fi
  if contains_harness codex-app; then
    printf '  - Codex App preview: %s/.ai/generated/codex-app-install\n' "$TARGET_PATH"
  fi
  if contains_harness pi; then
    printf '  - Pi: no live Pi files are written by this installer\n'
  fi
}

print_handoff_explanation() {
  cat <<EOFHANDOFF

Where files go and why:
  - Project you launched from: $SOURCE_PROJECT_PATH
  - Canonical project root:    $CANONICAL_PROJECT_ROOT
  - Alfred suite install path: $TARGET_PATH
  - Runtime profiles path:    $HOME/.alfred/runtime-profiles
  - Trace path:               $HOME/.alfred/observability/install-trace.json
  - Install docs:             $TARGET_PATH/site/docs/install.html

Why outside the project by default:
  Alfred is preview-first. It keeps generated suite and harness artifacts under
  ~/.alfred so the installer does not unexpectedly mutate your project or write
  live opencode/Codex/Pi config. You audit generated previews first, then decide
  what should be copied into the project or into a live harness location.

Expected generated preview locations after apply:
$(print_expected_preview_locations)
EOFHANDOFF
}

pretty_path() {
  path_value="$1"
  case "$path_value" in
    "$CANONICAL_PROJECT_ROOT") printf '<project>' ;;
    "$CANONICAL_PROJECT_ROOT"/*) printf '<project>/%s' "${path_value#"$CANONICAL_PROJECT_ROOT"/}" ;;
    "$HOME") printf '~' ;;
    "$HOME"/*) printf '~/%s' "${path_value#"$HOME"/}" ;;
    *) printf '%s' "$path_value" ;;
  esac
}

write_handoff_summary() {
  HANDOFF_SUMMARY_FILE="$TARGET_PATH/.ai/generated/install-handoff.txt"
  mkdir -p "$(dirname "$HANDOFF_SUMMARY_FILE")"
  {
    printf 'Alfred install handoff\n'
    printf '======================\n\n'
    printf 'Project launched from: %s\n' "$SOURCE_PROJECT_PATH"
    printf 'Canonical project root: %s\n' "$CANONICAL_PROJECT_ROOT"
    printf 'Alfred suite install:  %s\n' "$TARGET_PATH"
    printf 'Runtime profiles:      %s\n' "$HOME/.alfred/runtime-profiles"
    printf 'Trace:                 %s\n' "$HOME/.alfred/observability/install-trace.json"
    printf 'Install docs:          %s\n\n' "$TARGET_PATH/site/docs/install.html"
    printf 'Why outside the project by default:\n'
    printf 'Alfred is preview-first. It keeps generated suite and harness artifacts under ~/.alfred so the installer does not unexpectedly mutate your project or write live opencode/Codex/Pi config.\n\n'
    printf 'Generated preview locations:\n'
    print_expected_preview_locations
  } > "$HANDOFF_SUMMARY_FILE"
}

apply_generated_directory() {
  source_root="$1"
  relative_dir="$2"
  if [ -d "$source_root/$relative_dir" ]; then
    mkdir -p "$CANONICAL_PROJECT_ROOT/$relative_dir"
    cp -R "$source_root/$relative_dir/." "$CANONICAL_PROJECT_ROOT/$relative_dir/"
    APPLIED_PROJECT_PATHS="${APPLIED_PROJECT_PATHS}
  - $(pretty_path "$CANONICAL_PROJECT_ROOT/$relative_dir")"
    APPLIED_ANY=true
  fi
}

apply_opencode_preview_to_project() {
  preview_dir="$TARGET_PATH/.ai/generated/opencode-install"
  [ -d "$preview_dir" ] || return 0
  apply_generated_directory "$preview_dir" ".opencode"
  if [ -f "$preview_dir/opencode.json.preview" ]; then
    cp "$preview_dir/opencode.json.preview" "$CANONICAL_PROJECT_ROOT/opencode.json"
    APPLIED_PROJECT_PATHS="${APPLIED_PROJECT_PATHS}
  - $(pretty_path "$CANONICAL_PROJECT_ROOT/opencode.json")"
    APPLIED_ANY=true
  fi
}

apply_codex_preview_to_project() {
  preview_dir=""
  for candidate in codex-cli-install codex-app-install codex-install; do
    if [ -d "$TARGET_PATH/.ai/generated/$candidate" ]; then
      preview_dir="$TARGET_PATH/.ai/generated/$candidate"
      break
    fi
  done
  [ -n "$preview_dir" ] || return 0
  apply_generated_directory "$preview_dir" ".codex"
  apply_generated_directory "$preview_dir" ".agents"
}

apply_selected_harness_files_to_project() {
  source_dir="$TARGET_PATH/.ai/generated"
  APPLIED_PROJECT_PATHS=""
  APPLIED_ANY=false
  if [ ! -d "$source_dir" ]; then
    log "No generated preview directory found at $source_dir"
    return 0
  fi
  if contains_harness opencode; then
    apply_opencode_preview_to_project
  fi
  if contains_harness codex-cli || contains_harness codex-app; then
    apply_codex_preview_to_project
  fi
  if [ "$APPLIED_ANY" = true ]; then
    cat <<EOFCOPIED

Applied selected harness files into this project:
$APPLIED_PROJECT_PATHS

No global user-level harness config was written.
EOFCOPIED
  else
    log "No selected harness files were available to apply into the project."
  fi
}

clear_for_guided_handoff() {
  if [ "$TUI_USED" = true ] && [ -z "${ALFRED_INSTALL_HANDOFF_INPUT:-}" ] && has_dev_tty; then
    printf '\033[H\033[2J'
  fi
}

print_compact_final_handoff() {
  cat <<EOFHANDOFF
==============================================================
ALFRED INSTALL COMPLETE
==============================================================
Status:         Applied safely
Project files:  Not copied yet
Alfred home:    $(pretty_path "$TARGET_PATH")
Audit details:  $(pretty_path "$HANDOFF_SUMMARY_FILE")

Why nothing moved into the project yet:
  Alfred generated previews first so you can audit them before writing live
  opencode/Codex/Pi files.

Final handoff choices:
  1) Keep everything in ~/.alfred for now. Safe default.
  2) Apply selected harness files into this project now.
  3) Exit without copying anything else.
EOFHANDOFF
}

run_final_handoff() {
  write_handoff_summary
  if [ "$TUI_USED" = true ] || [ -n "${ALFRED_INSTALL_HANDOFF_INPUT:-}" ]; then
    clear_for_guided_handoff
    print_compact_final_handoff
    handoff_ask 'Final handoff [1=keep, 2=apply files into project, 3=exit, default 1]: ' '1'
    case "$HANDOFF_ANSWER" in
      1|keep|"") printf '\nKeeping generated artifacts in ~/.alfred. No project files were copied.\n' ;;
      2|copy|apply|apply-files) apply_selected_harness_files_to_project ;;
      3|exit|cancel) printf '\nExiting after install. No project files were copied.\n' ;;
      *) err "Unknown final handoff choice: $HANDOFF_ANSWER" ;;
    esac
  else
    print_handoff_explanation
    cat <<EOFCHOICES

Final handoff choices:
  1) Keep everything in ~/.alfred for now (recommended until you audit).
  2) Apply selected harness files into this project now.
  3) Exit/cancel here. Nothing else will be copied.
EOFCHOICES
    cat <<EOFNONINTERACTIVE

Non-interactive install: no project files were copied.
To apply selected harness files into the project, rerun guided apply mode
or copy from the generated previews:
  $TARGET_PATH/.ai/generated
EOFNONINTERACTIVE
  fi
}

cat <<EOFPLAN
==============================================================
ALFRED SUITE INSTALL PREVIEW
==============================================================
Version:        $VERSION
Edition:        $EDITION
Name:           $NAME
Target path:    $TARGET_PATH
Harnesses:      $SELECTED_HARNESSES
Detected:       $(display_harness_status)
Profile:        $DISPLAY_PROFILE_STRATEGY
Memory setup:   $DISPLAY_MEMORY_SETUP
Model strategy: $MODEL_STRATEGY
Model approval: $MODEL_WRITE_APPROVED
Components:     $COMPONENT_PLAN
Node:           $node_status
Provider calls: 0
TUI used:       $TUI_USED
TUI mode:       $TUI_MODE

What --name means:
  A local human-readable install/context identifier. It is used to derive
  the default install path (~/.alfred/installs/$NAME) and label traces.

Safety:
  - This installer does not install Pi by default.
  - This installer does not write live opencode/Codex/Pi harness config.
  - Harness-specific files must be generated as previews and applied only
    after explicit human approval.
EOFPLAN

print_model_assignment_preview

if [ "$APPLY" != true ] || [ "$TUI_USED" != true ]; then
  print_handoff_explanation
fi

if [ "$APPLY" != true ]; then
  if [ "$TUI_USED" = true ]; then
    cat <<EOFNEXT

No files were written. Preview-only mode is the default.
Project modified: no.
To apply safe suite install steps, rerun the guided installer and choose apply:
  curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh

Automation fallback when the decisions are already known:
  curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --edition=$EDITION --name=$NAME --harness=$HARNESS --apply
EOFNEXT
  else
  cat <<EOFNEXT

No files were written. Preview-only mode is the default.
Project modified: no.
To apply safe suite install steps, rerun with:
  --apply

Examples:
  curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --edition=$EDITION --name=$NAME --apply
  curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --edition=$EDITION --name=$NAME --harness=opencode --apply
EOFNEXT
  fi
  exit 0
fi

[ "$node_status" != "missing" ] || err "Node.js is required for --apply. Install Node $NODE_MIN+ first."
case "$node_status" in
  too_old:*) err "Node $node_status found, but Node $NODE_MIN+ is required." ;;
esac

parent_dir="$(dirname "$TARGET_PATH")"
mkdir -p "$parent_dir"

if [ "$NO_CLONE" = true ]; then
  [ -d "$TARGET_PATH" ] || err "--no-clone requires an existing --path directory: $TARGET_PATH"
  log "Reusing existing Alfred repo at $TARGET_PATH"
else
  if [ -d "$TARGET_PATH/.git" ]; then
    log "Repo already exists at $TARGET_PATH; pulling latest fast-forward if possible."
    (cd "$TARGET_PATH" && git pull --ff-only 2>/dev/null) || log "Skipping pull; repo may already be current or offline."
  else
    if [ -e "$TARGET_PATH" ]; then
      err "Target path exists but is not an Alfred git repo: $TARGET_PATH"
    fi
    command -v git >/dev/null 2>&1 || err "git is required for --apply unless --no-clone is used."
    log "Cloning Alfred into $TARGET_PATH"
    git clone --depth 1 --branch "$DEFAULT_BRANCH" "$REPO_URL" "$TARGET_PATH" 2>/dev/null || git clone --depth 1 "$REPO_URL" "$TARGET_PATH"
  fi
fi

PROFILE_REPO="$HOME/.alfred/runtime-profiles"
case ",$COMPONENT_PLAN," in
  *,profile-manager,*)
    log "Initializing runtime profile repository at $PROFILE_REPO"
    mkdir -p "$PROFILE_REPO/profiles" "$PROFILE_REPO/profiles.local"
    if [ ! -f "$PROFILE_REPO/.gitignore" ]; then
      printf 'profiles.local/\n.DS_Store\n' > "$PROFILE_REPO/.gitignore"
    fi
    if [ ! -f "$PROFILE_REPO/README.md" ]; then
      printf '# Alfred Runtime Profiles\n\nShared defaults live in profiles/. Machine-private overlays live in profiles.local/.\n' > "$PROFILE_REPO/README.md"
    fi
    ;;
esac

if contains_harness opencode; then
  if [ -f "$TARGET_PATH/packages/opencode-adapter/src/cli.js" ]; then
    log "Generating opencode preview under $TARGET_PATH/.ai/generated/opencode-install"
    (cd "$TARGET_PATH" && node packages/opencode-adapter/src/cli.js --output .ai/generated/opencode-install >/dev/null)
  else
    log "opencode adapter preview skipped; package not found in installed repo."
  fi
fi

if contains_harness codex-cli || contains_harness codex-app; then
  if [ -f "$TARGET_PATH/packages/codex-adapter/src/cli.js" ]; then
    log "Generating shared Codex preview under $TARGET_PATH/.ai/generated/codex-install"
    (cd "$TARGET_PATH" && node packages/codex-adapter/src/cli.js --output .ai/generated/codex-install >/dev/null)
    if contains_harness codex-cli; then
      log "Generating Codex CLI preview under $TARGET_PATH/.ai/generated/codex-cli-install"
      (cd "$TARGET_PATH" && node packages/codex-adapter/src/cli.js --output .ai/generated/codex-cli-install >/dev/null)
    fi
    if contains_harness codex-app; then
      log "Generating Codex App preview under $TARGET_PATH/.ai/generated/codex-app-install"
      (cd "$TARGET_PATH" && node packages/codex-adapter/src/cli.js --output .ai/generated/codex-app-install >/dev/null)
    fi
  else
    log "Codex adapter preview skipped; package not found in installed repo."
  fi
fi

if contains_harness pi; then
  log "Pi selected. No live Pi files are written by the suite installer. Use adapter previews and approval flow."
fi

if [ "$SELECTED_HARNESSES" = "none" ]; then
  log "No harness selected/detected. Suite repo installed; harness previews skipped."
fi

write_approved_model_assignment

TRACE_DIR="$HOME/.alfred/observability"
mkdir -p "$TRACE_DIR"
TRACE_FILE="$TRACE_DIR/install-trace.json"
if [ "$MODEL_CONFIG_WRITTEN" = true ]; then
  INSTALL_TRACE_EVENTS='["install_management_operation", "model_assignment_configured", "provider_request_avoided"]'
else
  INSTALL_TRACE_EVENTS='["install_management_operation", "provider_request_avoided"]'
fi
TRACE_TMP="$TRACE_FILE.$$ .tmp"
TRACE_TMP="$(printf '%s' "$TRACE_TMP" | tr -d ' ')"
cat > "$TRACE_TMP" <<EOFTRACE
{
  "trace_id": "suite-install",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "event": "install_management_operation",
  "actor": "alfred-suite-install",
  "data": {
    "operation": "install",
    "edition": "$EDITION",
    "name": "$NAME",
    "target_path": "$TARGET_PATH",
    "harness": "$SELECTED_HARNESSES",
    "harnesses": "$SELECTED_HARNESSES",
    "harness_status": "$HARNESS_STATUS",
    "tui_mode": "$TUI_MODE",
    "profile_strategy": "$PROFILE_STRATEGY",
    "memory_setup": "$MEMORY_SETUP",
    "model_strategy": "$MODEL_STRATEGY",
    "model_write_approved": $MODEL_WRITE_APPROVED,
    "model_config_written": $MODEL_CONFIG_WRITTEN,
    "catalog": $CATALOG_TRACE_AGGREGATE,
    "trace_events": $INSTALL_TRACE_EVENTS,
    "components": "$COMPONENT_PLAN",
    "status": "pass",
    "human_approval": true,
    "provider_calls": 0
  }
}
EOFTRACE
mv "$TRACE_TMP" "$TRACE_FILE"

if [ "$TUI_USED" != true ]; then
  cat <<EOFDONE

==============================================================
ALFRED SUITE INSTALL APPLIED
==============================================================
Repository:      $TARGET_PATH
Profile repo:    $PROFILE_REPO
Trace:           $TRACE_FILE
Harnesses:       $SELECTED_HARNESSES
Detected:        $(display_harness_status)
Provider calls:  0

Next steps:
  - Audit generated harness previews before copying anything live.
  - If you want project-local harness files now, choose the apply option below.
  - Runtime profile commands live in: $TARGET_PATH/packages/profile-manager
  - Install docs: $TARGET_PATH/site/docs/install.html
EOFDONE
fi

run_final_handoff
