#!/usr/bin/env bash
# Pull-based deploy for the EC2 backend (IN-12; docs/areas/cloud.md "Automatic updates").
#
# Run by cron every 5 minutes on the instance. If origin/$DEPLOY_BRANCH has new
# commits, fast-forwards the checkout and rebuilds/recreates the backend
# services. Skips a round while a document is being ingested, because
# recreating the worker would kill that ingestion; the next round retries.
#
#   scripts/deploy-ec2.sh            # deploy if there is something new
#   scripts/deploy-ec2.sh --dry-run  # report what it would do, change nothing
#
# Settings (environment): DEPLOY_BRANCH (default main).
set -euo pipefail

BRANCH="${DEPLOY_BRANCH:-main}"
SERVICES=(redis server rag-service speech-ocr-service ingestion-service ingestion-worker)
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') deploy: $*"; }

# One run at a time: a build can outlast the 5-minute cron interval.
exec 9>"/tmp/a2603-deploy.lock"
if ! flock -n 9; then
    log "previous run still going; skipping"
    exit 0
fi

git fetch --quiet origin "$BRANCH"
local_rev="$(git rev-parse HEAD)"
remote_rev="$(git rev-parse "origin/$BRANCH")"
if [[ "$local_rev" == "$remote_rev" ]]; then
    exit 0  # nothing new; stay quiet so the log only shows real events
fi
log "origin/$BRANCH moved: ${local_rev:0:7} -> ${remote_rev:0:7}"

# BullMQ (default "bull" prefix) keeps jobs being processed in this list.
# If Redis isn't running, nothing can be ingesting, so carry on.
active="$(docker compose exec -T redis redis-cli LLEN bull:ingestion:active 2>/dev/null || echo 0)"
active="${active//[^0-9]/}"
if [[ "${active:-0}" -gt 0 ]]; then
    log "a document is being ingested ($active active job); will retry next round"
    exit 0
fi

if $DRY_RUN; then
    log "dry run: would fast-forward to ${remote_rev:0:7} and rebuild: ${SERVICES[*]}"
    exit 0
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "$BRANCH" ]]; then
    log "checkout is on '$current_branch', not '$BRANCH'; run: git checkout $BRANCH"
    exit 1
fi
# --ff-only: never merge or overwrite; local edits on the box stop the deploy.
if ! git merge --ff-only --quiet "origin/$BRANCH"; then
    log "cannot fast-forward (local changes on the instance?); fix by hand"
    exit 1
fi

log "building and restarting: ${SERVICES[*]}"
docker compose up -d --build "${SERVICES[@]}"
docker image prune -f >/dev/null
log "deployed ${remote_rev:0:7}"
