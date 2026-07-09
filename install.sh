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

run_app_tui_if_available() {
  if [ "$HAD_ARGS" = true ] && [ "${ALFRED_INSTALL_FORCE_TUI:-}" != "1" ]; then
    return 1
  fi
  if [ "${ALFRED_INSTALL_FORCE_TUI:-}" != "1" ] && ! has_dev_tty; then
    return 1
  fi
  command -v node >/dev/null 2>&1 || return 1

  app_tui_script=""
  app_tui_tmp=""
  if [ -n "$INSTALLER_DIR" ] && [ -f "$INSTALLER_DIR/scripts/tui/install-app.mjs" ]; then
    app_tui_script="$INSTALLER_DIR/scripts/tui/install-app.mjs"
  elif [ -f "./scripts/tui/install-app.mjs" ]; then
    app_tui_script="./scripts/tui/install-app.mjs"
  else
    command -v curl >/dev/null 2>&1 || return 1
    app_tui_tmp="${TMPDIR:-/tmp}/alfred-install-app-tui.$$.mjs"
    curl -fsSL "https://raw.githubusercontent.com/GOI17/alfred/$DEFAULT_BRANCH/scripts/tui/install-app.mjs" -o "$app_tui_tmp" 2>/dev/null || return 1
    app_tui_script="$app_tui_tmp"
  fi

  app_tui_out="${TMPDIR:-/tmp}/alfred-install-app-tui.$$.env"
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
      node "$app_tui_script" > "$app_tui_out"
    then
      app_tui_status=0
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
      ALFRED_INSTALL_APP_TUI_RESULT_FILE="$app_tui_out" \
      node "$app_tui_script" < /dev/tty > /dev/tty
    then
      app_tui_status=0
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
      node "$app_tui_script" > "$app_tui_out"
    then
      app_tui_status=0
    fi
  fi
  if [ "$app_tui_status" -eq 0 ] && [ -s "$app_tui_out" ]; then
    # shellcheck disable=SC1090
    . "$app_tui_out"
    rm -f "$app_tui_out" "$app_tui_tmp"
    return 0
  fi
  rm -f "$app_tui_out" "$app_tui_tmp"
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

run_app_tui_if_available || run_tui_if_available

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
Profile:        $PROFILE_STRATEGY
Memory setup:   $MEMORY_SETUP
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

if [ "$APPLY" != true ]; then
  if [ "$TUI_USED" = true ]; then
    cat <<EOFNEXT

No files were written. Preview-only mode is the default.
To apply safe suite install steps, rerun the guided installer and choose apply:
  curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh

Automation fallback when the decisions are already known:
  curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --edition=$EDITION --name=$NAME --harness=$HARNESS --apply
EOFNEXT
  else
  cat <<EOFNEXT

No files were written. Preview-only mode is the default.
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

TRACE_DIR="$HOME/.alfred/observability"
mkdir -p "$TRACE_DIR"
TRACE_FILE="$TRACE_DIR/install-trace.json"
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
    "components": "$COMPONENT_PLAN",
    "status": "pass",
    "human_approval": true,
    "provider_calls": 0
  }
}
EOFTRACE
mv "$TRACE_TMP" "$TRACE_FILE"

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
  - Review generated harness previews before copying anything live.
  - Runtime profile commands live in: $TARGET_PATH/packages/profile-manager
  - Install docs: $TARGET_PATH/site/docs/install.html
EOFDONE
