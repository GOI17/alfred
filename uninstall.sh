#!/bin/sh
# Alfred Pi Agent Uninstall Script
# Usage: curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/uninstall.sh | sh
# Or:    curl -fsSL https://raw.githubusercontent.com/GOI17/alfred/main/uninstall.sh | sh -s -- --path ./alfred-workspace
#
# This script removes only Pi agent files from a user workspace.
# It does NOT remove user files or the full Alfred repository.

set -e

TARGET_PATH=""

# --- Helper Functions ---

logger() {
  echo "[pi-uninstall] $1"
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

validate_uninstall_path() {
  path="$1"

  # Check if path is empty
  if [ -z "$path" ]; then
    echo "error:uninstall_path_empty"
    return 1
  fi

  # Check if path is root
  if [ "$path" = "/" ]; then
    echo "error:uninstall_path_is_root"
    return 1
  fi

  # Check for protected segments
  case "$path" in
    *".ai/"*)     echo "error:uninstall_path_protected"; return 1 ;;
    *".opencode/"*) echo "error:uninstall_path_protected"; return 1 ;;
    *"/harnesses/"*) echo "error:uninstall_path_protected"; return 1 ;;
    *".ai"*)      echo "error:uninstall_path_protected"; return 1 ;;
    *".opencode"*) echo "error:uninstall_path_protected"; return 1 ;;
    *"harnesses"*) echo "error:uninstall_path_protected"; return 1 ;;
  esac

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
      echo "  --path    Uninstall target directory (default: current directory)"
      echo "  --dry-run Preview operation without making changes"
      exit 0
      ;;
    *)
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

logger "Validating uninstall path: ${TARGET_PATH}"

validation_result=$(validate_uninstall_path "$TARGET_PATH")
if [ $? -ne 0 ]; then
  case "$validation_result" in
    error:uninstall_path_is_root)
      logger "ERROR: Cannot uninstall from root (/)."
      exit 1
      ;;
    error:uninstall_path_protected)
      logger "ERROR: Cannot uninstall from protected paths (.ai/, .opencode/, harnesses/)."
      exit 1
      ;;
    error:uninstall_path_empty)
      logger "ERROR: Uninstall path is empty."
      exit 1
      ;;
    *)
      logger "ERROR: Unknown validation error: $validation_result"
      exit 1
      ;;
  esac
fi

# Check if Alfred is actually installed here
alfred_dir="${TARGET_PATH}/.alfred"
agents_md="${TARGET_PATH}/AGENTS.md"

if [ ! -d "$alfred_dir" ] && [ ! -f "$agents_md" ]; then
  logger "ERROR: No Alfred installation found in ${TARGET_PATH}"
  logger "Nothing to uninstall."
  exit 1
fi

logger "Path validation passed."

# --- Dry Run Mode ---

if [ "$DRY_RUN" = true ]; then
  logger "DRY-RUN MODE: No files will be removed."
  logger "Would uninstall from: ${TARGET_PATH}"
  if [ -d "$alfred_dir" ]; then
    logger "Would remove directory: ${alfred_dir}"
  fi
  if [ -f "$agents_md" ]; then
    logger "Would remove file: ${agents_md}"
  fi
  exit 0
fi

# --- Uninstall ---

logger "Uninstalling Alfred Pi Agent from: ${TARGET_PATH}"

uninstall_success=true
error_code=null

# Remove .alfred directory
if [ -d "$alfred_dir" ]; then
  logger "Removing .alfred directory..."
  rm -rf "$alfred_dir"
  logger "Removed ${alfred_dir}"
fi

# Remove AGENTS.md (created by install)
if [ -f "$agents_md" ]; then
  logger "Removing AGENTS.md..."
  rm -f "$agents_md"
  logger "Removed ${agents_md}"
fi

# Note: README.md is left in place as it may contain user modifications
# User can remove it manually if desired

# --- Finalization ---

logger "Uninstall complete."
logger "Removed Alfred Pi Agent from: ${TARGET_PATH}"

# Emit trace
write_trace "$TARGET_PATH" "uninstall" "pass" "$error_code"

logger "Trace written to: ${TARGET_PATH}/.alfred/observability/install-trace.json"
logger "Restart your harness to complete the uninstallation."