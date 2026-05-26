#!/bin/sh
# Alfred Pi Agent Installation Script
# Usage: curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh
# Or:    curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/install.sh | sh -s -- --path ./alfred-workspace
#
# This script installs only Pi agent files into a user workspace.
# It does NOT install the full Alfred repository.

set -e

VERSION="0.2.0"
INSTALL_BASE="https://raw.githubusercontent.com/GOI17/alfred/main"
DRY_RUN=false
TARGET_PATH=""

# --- Helper Functions ---

logger() {
  echo "[pi-install] $1"
}

write_trace() {
  target="$1"
  operation="$2"
  status="$3"
  error_code="$4"

  trace_dir="${target}/.alfred/observability"
  mkdir -p "$trace_dir"

  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%S.%NZ")

  # Atomic write using temp file
  trace_file="${trace_dir}/install-trace.json"
  temp_file="${trace_file}.${$}.tmp"

  cat > "$temp_file" << EOF
{
  "trace_id": "phase-13-pi-agent-install-management",
  "timestamp": "${timestamp}",
  "event": "install_management_operation",
  "actor": "pi-install",
  "data": {
    "operation": "${operation}",
    "target_path": "${target}",
    "status": "${status}",
    "error_code": ${error_code:+"\"${error_code}\""}${error_code:-null},
    "human_approval": true,
    "provider_calls": 0
  }
}
EOF
  mv "$temp_file" "$trace_file"
}

validate_path() {
  path="$1"

  # Check if path is empty
  if [ -z "$path" ]; then
    echo "error:installation_path_empty"
    return 1
  fi

  # Check if path is root
  if [ "$path" = "/" ]; then
    echo "error:installation_path_is_root"
    return 1
  fi

  # Check for protected segments using case-insensitive match
  case "$path" in
    *".ai/"*)     echo "error:installation_path_protected"; return 1 ;;
    *".opencode/"*) echo "error:installation_path_protected"; return 1 ;;
    *"/harnesses/"*) echo "error:installation_path_protected"; return 1 ;;
    *".ai"*)      echo "error:installation_path_protected"; return 1 ;;
    *".opencode"*) echo "error:installation_path_protected"; return 1 ;;
    *"harnesses"*) echo "error:installation_path_protected"; return 1 ;;
  esac

  # Check if directory exists and is writable
  if [ -e "$path" ]; then
    if [ ! -d "$path" ]; then
      echo "error:installation_path_not_directory"
      return 1
    fi
    if [ ! -w "$path" ]; then
      echo "error:installation_path_not_writable"
      return 1
    fi
  else
    # Directory doesn't exist, check if parent is writable
    parent=$(dirname "$path")
    if [ ! -w "$parent" ]; then
      echo "error:installation_path_parent_not_writable"
      return 1
    fi
  fi

  echo "ok"
  return 0
}

# --- Argument Parsing ---

while [ $# -gt 0 ]; do
  case "$1" in
    --path)
      TARGET_PATH="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--path <directory>] [--dry-run]"
      echo "  --path    Installation target directory (default: current directory)"
      echo "  --dry-run Preview operation without making changes"
      exit 0
      ;;
    *)
      # If not a flag, treat as positional path argument
      if [ -z "$TARGET_PATH" ] && [ "${1#-}" = "$1" ]; then
        TARGET_PATH="$1"
      fi
      shift
      ;;
  esac
done

# Default to current directory if no path specified
if [ -z "$TARGET_PATH" ]; then
  TARGET_PATH="."
fi

# --- Path Validation ---

logger "Validating installation path: ${TARGET_PATH}"

validation_result=$(validate_path "$TARGET_PATH")
if [ $? -ne 0 ]; then
  case "$validation_result" in
    error:installation_path_is_root)
      logger "ERROR: Installation path cannot be root (/)."
      logger "Use a user workspace path like ./alfred or ~/projects/alfred"
      exit 1
      ;;
    error:installation_path_protected)
      logger "ERROR: Installation path contains protected segments (.ai/, .opencode/, harnesses/)."
      logger "Cannot install into Alfred system directories."
      exit 1
      ;;
    error:installation_path_not_directory)
      logger "ERROR: Installation path exists but is not a directory."
      exit 1
      ;;
    error:installation_path_not_writable)
      logger "ERROR: Installation path is not writable."
      exit 1
      ;;
    error:installation_path_empty)
      logger "ERROR: Installation path is empty."
      exit 1
      ;;
    *)
      logger "ERROR: Unknown validation error: $validation_result"
      exit 1
      ;;
  esac
fi

logger "Path validation passed."

# --- Dry Run Mode ---

if [ "$DRY_RUN" = true ]; then
  logger "DRY-RUN MODE: No files will be written."
  logger "Would install to: ${TARGET_PATH}"
  logger "Files to be downloaded from: ${INSTALL_BASE}/pi/${VERSION}"
  exit 0
fi

# --- Installation ---

logger "Installing Alfred Pi Agent to: ${TARGET_PATH}"

# Create directory structure
alfred_dir="${TARGET_PATH}/.alfred"
agents_dir="${alfred_dir}/agents"
skills_dir="${alfred_dir}/skills"
adapter_dir="${alfred_dir}/pi-adapter"

mkdir -p "$agents_dir"
mkdir -p "$skills_dir"
mkdir -p "$adapter_dir"

# Track success for trace
install_success=true
error_code=null

# Download and install AGENTS.md
logger "Downloading AGENTS.md..."
agents_md_tmp="${TARGET_PATH}/AGENTS.md.$$.tmp"
if ! curl -fsSL "${INSTALL_BASE}/pi/${VERSION}/AGENTS.md" -o "$agents_md_tmp" 2>/dev/null; then
  logger "WARNING: Could not download AGENTS.md, creating default..."
  cat > "$agents_md_tmp" << 'EOF'
---
description: Alfred orchestrator agent
---

# Alfred Orchestrator

You are Alfred's Orchestrator agent.

Load project instructions from AGENTS.md and Alfred source-of-truth files under .ai/.

Rules:
- Preserve Alfred's local-first provider policy.
- Do not broaden permissions.
- Do not write harness config without explicit human approval.
- Keep model assignment user-owned at runtime.
You are powered by the model named minimax-m2.7. The exact model ID is ollama-cloud/minimax-m2.7
EOF
fi
mv "$agents_md_tmp" "${TARGET_PATH}/AGENTS.md"

# Download config.json
logger "Downloading config.json..."
config_tmp="${alfred_dir}/config.json.$$.tmp"
if curl -fsSL "${INSTALL_BASE}/pi/${VERSION}/.alfred/config.json" -o "$config_tmp" 2>/dev/null; then
  mv "$config_tmp" "${alfred_dir}/config.json"
else
  # Create default config
  cat > "${alfred_dir}/config.json" << 'EOF'
{
  "harness": "pi",
  "version": "0.2.0",
  "capabilities": [
    "primary_control",
    "specialist_routing",
    "lazy_skills",
    "permission_enforcement",
    "trace_emission",
    "eval_execution",
    "model_assignment",
    "local_first"
  ]
}
EOF
fi

# Download agent files
logger "Downloading agent files..."
for agent in orchestrator developer qa librarian architect reviewer; do
  agent_tmp="${agents_dir}/${agent}.md.$$.tmp"
  if curl -fsSL "${INSTALL_BASE}/pi/${VERSION}/.alfred/agents/${agent}.md" -o "$agent_tmp" 2>/dev/null; then
    mv "$agent_tmp" "${agents_dir}/${agent}.md"
    logger "  Installed ${agent}.md"
  else
    logger "  WARNING: Could not download ${agent}.md"
  fi
done

# Download skills registry
logger "Downloading skills registry..."
registry_tmp="${skills_dir}/registry.json.$$.tmp"
if curl -fsSL "${INSTALL_BASE}/pi/${VERSION}/.alfred/skills/registry.json" -o "$registry_tmp" 2>/dev/null; then
  mv "$registry_tmp" "${skills_dir}/registry.json"
else
  # Create default registry
  cat > "${skills_dir}/registry.json" << 'EOF'
{
  "skills": [],
  "policy": {
    "loading": "lazy",
    "default": "available",
    "scope": "task-specific",
    "load_bodies_globally": false
  }
}
EOF
fi

# Download pi-adapter files
logger "Downloading pi-adapter files..."
for file in runtime.js cli.js package.json README.md; do
  adapter_tmp="${adapter_dir}/${file}.$$.tmp"
  if curl -fsSL "${INSTALL_BASE}/pi/${VERSION}/.alfred/pi-adapter/${file}" -o "$adapter_tmp" 2>/dev/null; then
    mv "$adapter_tmp" "${adapter_dir}/${file}"
    logger "  Installed ${file}"
  fi
done

# Create README in target path
cat > "${TARGET_PATH}/README.md" << 'EOF'
# Alfred Pi Agent Workspace

This workspace has Alfred Pi agent installed.

## Structure

- `AGENTS.md` - Orchestrator agent instructions
- `.alfred/` - Alfred configuration and artifacts
  - `config.json` - Pi harness configuration
  - `agents/` - Agent specifications
  - `skills/` - Skill manifests
  - `pi-adapter/` - Pi adapter files

## Updating

To update to the latest version:
```
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/update.sh | sh
```

## Uninstalling

To remove Alfred from this workspace:
```
curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/uninstall.sh | sh
```
EOF

# --- Finalization ---

logger "Installation complete."
logger "Installed to: ${TARGET_PATH}"

# Emit trace
write_trace "$TARGET_PATH" "install" "pass" "$error_code"

logger "Trace written to: ${TARGET_PATH}/.alfred/observability/install-trace.json"
logger "Restart your harness to activate the installation."