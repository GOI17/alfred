#!/bin/sh
# Alfred suite installer. Local-first, preview-first, no harness writes by default.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --edition=coding --name=acme
#   curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --edition=full --name=acme --apply
#   curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --component=profile-manager --name=acme
#
# Safety:
#   - Without --apply this prints an install plan only and writes no files.
#   - It never installs Pi/opencode/Codex live harness config by default.
#   - Unknown flags fail closed instead of being ignored.

set -e

VERSION="0.4.1.1"
REPO_URL="https://github.com/GOI17/alfred.git"
DEFAULT_BRANCH="main"
NODE_MIN="22"

EDITION="coding"
NAME="default"
TARGET_PATH=""
HARNESS="auto"
APPLY=false
NO_CLONE=false
COMPONENTS=""

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
  --harness=<auto|opencode|codex|pi|none>
                                  Harness to preview. Default: auto-detect only.
  --apply                         Apply safe suite install steps. Without this, preview only.
  --dry-run                       Alias for preview-only mode.
  --no-clone                      With --apply, reuse an existing repo at --path.
  --help                          Show help.

Examples:
  install.sh --edition=coding --name=acme
  install.sh --edition=coding --name=acme --harness=opencode --apply
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

case "$EDITION" in
  coding|memory|full) ;;
  *) err "Unknown edition: $EDITION (use coding, memory, or full)" ;;
esac

case "$HARNESS" in
  auto|opencode|codex|pi|none) ;;
  *) err "Unknown harness: $HARNESS (use auto, opencode, codex, pi, or none)" ;;
esac

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

resolve_harness() {
  if [ "$HARNESS" != "auto" ]; then
    printf '%s' "$HARNESS"
    return 0
  fi
  if [ -d ".opencode" ] || command -v opencode >/dev/null 2>&1; then
    printf 'opencode'
    return 0
  fi
  if [ -d ".codex" ] || [ -d ".agents" ] || [ -n "${CODEX_HOME:-}" ]; then
    printf 'codex'
    return 0
  fi
  printf 'none'
}

RESOLVED_HARNESS="$(resolve_harness)"

edition_components() {
  if [ -n "$COMPONENTS" ]; then
    printf '%s' "$COMPONENTS"
    return 0
  fi
  case "$EDITION" in
    coding) printf 'core,agents,skills,profile-manager,opencode-adapter,codex-adapter,evals' ;;
    memory) printf 'memory,memory-server,memory-client,memory-mcp,memory-openapi,chatgpt-adapter,anthropic-adapter,gemini-adapter,console,console-web' ;;
    full) printf 'core,agents,skills,profile-manager,opencode-adapter,codex-adapter,evals,memory,memory-server,memory-client,memory-mcp,memory-openapi,chatgpt-adapter,anthropic-adapter,gemini-adapter,console,console-web' ;;
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
Harness:        $RESOLVED_HARNESS
Components:     $COMPONENT_PLAN
Node:           $node_status
Provider calls: 0

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
  cat <<EOFNEXT

No files were written. Preview-only mode is the default.
To apply safe suite install steps, rerun with:
  --apply

Examples:
  curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --edition=$EDITION --name=$NAME --apply
  curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --edition=$EDITION --name=$NAME --harness=opencode --apply
EOFNEXT
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

case "$RESOLVED_HARNESS" in
  opencode)
    if [ -f "$TARGET_PATH/packages/opencode-adapter/src/cli.js" ]; then
      log "Generating opencode preview under $TARGET_PATH/.ai/generated/opencode-install"
      (cd "$TARGET_PATH" && node packages/opencode-adapter/src/cli.js --output .ai/generated/opencode-install >/dev/null)
    else
      log "opencode adapter preview skipped; package not found in installed repo."
    fi
    ;;
  codex)
    if [ -f "$TARGET_PATH/packages/codex-adapter/src/cli.js" ]; then
      log "Generating Codex preview under $TARGET_PATH/.ai/generated/codex-install"
      (cd "$TARGET_PATH" && node packages/codex-adapter/src/cli.js --output .ai/generated/codex-install >/dev/null)
    else
      log "Codex adapter preview skipped; package not found in installed repo."
    fi
    ;;
  pi)
    log "Pi selected. No live Pi files are written by the suite installer. Use adapter previews and approval flow."
    ;;
  none)
    log "No harness selected/detected. Suite repo installed; harness previews skipped."
    ;;
esac

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
    "harness": "$RESOLVED_HARNESS",
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
Harness:         $RESOLVED_HARNESS
Provider calls:  0

Next steps:
  - Review generated harness previews before copying anything live.
  - Runtime profile commands live in: $TARGET_PATH/packages/profile-manager
  - Install docs: $TARGET_PATH/site/docs/install.html
EOFDONE
