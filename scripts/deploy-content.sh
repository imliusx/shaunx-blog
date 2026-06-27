#!/usr/bin/env bash
set -Eeuo pipefail

REMOTE="origin"
BRANCH="main"
DELETE=1
RESTART=1
DRY_RUN=0
SKIP_GIT=0
ONLY_ON_CHANGE=0
FORCE=0
DATA_PATH_OVERRIDE=""
LOCK_FILE="/tmp/shaunx-blog-content-deploy.lock"

usage() {
  cat <<USAGE
Usage: scripts/deploy-content.sh [options]

Deploy Markdown content from the Git checkout into the runtime data directory.
Git content is treated as the source of truth for content/posts, content/pages,
and content/images.

Options:
  --branch <name>       Git branch to deploy. Default: main
  --remote <name>       Git remote to fetch. Default: origin
  --data-path <path>    Override DATA_PATH from .env
  --only-on-change      Exit without syncing when local HEAD already matches remote
  --force               Sync even when --only-on-change sees no new remote commit
  --no-delete           Do not delete files that exist only in the data directory
  --no-restart          Do not restart the Docker service after syncing content
  --skip-git            Do not fetch/reset Git; only sync current checkout content
  --dry-run             Show planned rsync changes without modifying files
  -h, --help            Show this help

Typical server usage:
  cd /opt/shaunx-blog
  scripts/deploy-content.sh

Automatic timer usage:
  scripts/deploy-content.sh --only-on-change

Preview changes:
  scripts/deploy-content.sh --dry-run
USAGE
}

log() {
  printf '[%s] %s\n' "$1" "$2"
}

fail() {
  log ERROR "$1" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch)
      [[ $# -ge 2 ]] || fail "--branch requires a value"
      BRANCH="$2"
      shift 2
      ;;
    --remote)
      [[ $# -ge 2 ]] || fail "--remote requires a value"
      REMOTE="$2"
      shift 2
      ;;
    --data-path)
      [[ $# -ge 2 ]] || fail "--data-path requires a value"
      DATA_PATH_OVERRIDE="$2"
      shift 2
      ;;
    --only-on-change)
      ONLY_ON_CHANGE=1
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --no-delete)
      DELETE=0
      shift
      ;;
    --no-restart)
      RESTART=0
      shift
      ;;
    --skip-git)
      SKIP_GIT=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
APP_DIR=$(cd -- "$SCRIPT_DIR/.." && pwd)
ENV_FILE="$APP_DIR/.env"
COMPOSE_FILE="$APP_DIR/docker/docker-compose.yml"
SOURCE_CONTENT="$APP_DIR/content"

command -v git >/dev/null 2>&1 || fail "git is required"
command -v rsync >/dev/null 2>&1 || fail "rsync is required"

if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    log WARN "Another content deploy is already running. Exiting."
    exit 0
  fi
else
  log WARN "flock not found; deploy lock is disabled"
fi

[[ -d "$APP_DIR/.git" ]] || fail "Not a Git checkout: $APP_DIR"
[[ -d "$SOURCE_CONTENT" ]] || fail "Source content directory not found: $SOURCE_CONTENT"

read_env_value() {
  local key="$1"
  local file="$2"
  [[ -f "$file" ]] || return 1
  awk -F= -v key="$key" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      value = substr($0, index($0, "=") + 1)
      gsub(/^"|"$/, "", value)
      gsub(/^'"'"'|'"'"'$/, "", value)
      print value
      exit
    }
  ' "$file"
}

if [[ -n "$DATA_PATH_OVERRIDE" ]]; then
  DATA_PATH="$DATA_PATH_OVERRIDE"
else
  DATA_PATH=$(read_env_value DATA_PATH "$ENV_FILE" || true)
  DATA_PATH=${DATA_PATH:-./shaunx-blog-data}
fi

if [[ "$DATA_PATH" != /* ]]; then
  DATA_PATH="$APP_DIR/$DATA_PATH"
fi

TARGET_CONTENT="$DATA_PATH/content"

log INFO "App dir       : $APP_DIR"
log INFO "Source content: $SOURCE_CONTENT"
log INFO "Target content: $TARGET_CONTENT"
log INFO "Git source    : $REMOTE/$BRANCH"
[[ $DELETE -eq 1 ]] && log WARN "Delete mode   : enabled; data content will mirror Git content"
[[ $ONLY_ON_CHANGE -eq 1 ]] && log INFO "Change check  : enabled"
[[ $DRY_RUN -eq 1 ]] && log WARN "Dry run       : enabled"

cd "$APP_DIR"

if [[ $SKIP_GIT -eq 0 ]]; then
  log INFO "Fetching latest Git content"
  git fetch "$REMOTE" "$BRANCH"

  LOCAL_HEAD=$(git rev-parse HEAD)
  REMOTE_HEAD=$(git rev-parse "$REMOTE/$BRANCH")
  log INFO "Local HEAD    : $(git rev-parse --short HEAD)"
  log INFO "Remote HEAD   : $(git rev-parse --short "$REMOTE/$BRANCH")"

  if [[ $ONLY_ON_CHANGE -eq 1 && $FORCE -eq 0 && "$LOCAL_HEAD" == "$REMOTE_HEAD" ]]; then
    log OK "No remote changes. Deployment skipped."
    exit 0
  fi

  log INFO "Resetting checkout to $REMOTE/$BRANCH"
  git reset --hard "$REMOTE/$BRANCH"
else
  log WARN "Skipping Git fetch/reset"
fi

mkdir -p "$TARGET_CONTENT"

RSYNC_ARGS=(-av)
[[ $DELETE -eq 1 ]] && RSYNC_ARGS+=(--delete)
[[ $DRY_RUN -eq 1 ]] && RSYNC_ARGS+=(--dry-run)

log INFO "Syncing content"
rsync "${RSYNC_ARGS[@]}" "$SOURCE_CONTENT/" "$TARGET_CONTENT/"

if [[ $DRY_RUN -eq 1 ]]; then
  log OK "Dry run complete. No files were changed."
  exit 0
fi

if [[ $RESTART -eq 1 ]]; then
  command -v docker >/dev/null 2>&1 || fail "docker is required for restart"
  [[ -f "$ENV_FILE" ]] || fail "Missing .env file: $ENV_FILE"
  [[ -f "$COMPOSE_FILE" ]] || fail "Missing compose file: $COMPOSE_FILE"

  log INFO "Restarting Docker service"
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" restart blog
else
  log WARN "Skipping Docker restart"
fi

log OK "Content deploy complete"
