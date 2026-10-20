#!/usr/bin/env bash
# Pull-based deploy for the EC2 instance (IN-12; docs/areas/cloud.md "Automatic updates").
#
# Run by cron every 5 minutes on the instance. If origin/$DEPLOY_BRANCH has
# commits that aren't deployed yet, fast-forwards the checkout, builds the
# client into a new release folder that host nginx serves, rebuilds/recreates
# the backend services, then switches nginx to the new release. Skips a round
# while a document is being ingested, because recreating the worker would kill
# that ingestion; the next round retries. A failed round also retries: the
# deployed commit is only recorded once everything has succeeded.
#
#   scripts/deploy-ec2.sh            # deploy if there is something new
#   scripts/deploy-ec2.sh --dry-run  # report what it would do, change nothing
#
# Settings (environment): DEPLOY_BRANCH (default main), WEB_ROOT (default
# /var/www/a2603, created once by hand; see cloud.md "4. nginx").
set -euo pipefail

BRANCH="${DEPLOY_BRANCH:-main}"
WEB_ROOT="${WEB_ROOT:-/var/www/a2603}"
# The client isn't here: on the instance it is a static build served by nginx.
SERVICES=(redis server rag-service speech-ocr-service privacy-service ingestion-service ingestion-worker)
STATE_FILE="$HOME/.a2603-deployed-rev"
KEEP_RELEASES=3
ASSET_DAYS=7
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
# Compare against what last deployed in full, not HEAD: HEAD moves before the
# build, so a failed build would otherwise never be retried.
deployed_rev="$(cat "$STATE_FILE" 2>/dev/null || echo none)"
remote_rev="$(git rev-parse "origin/$BRANCH")"
if [[ "$deployed_rev" == "$remote_rev" ]]; then
    exit 0  # nothing new; stay quiet so the log only shows real events
fi
log "origin/$BRANCH moved: ${deployed_rev:0:7} -> ${remote_rev:0:7}"

# BullMQ (default "bull" prefix) keeps jobs being processed in this list.
# If Redis isn't running, nothing can be ingesting, so carry on.
active="$(docker compose exec -T redis redis-cli LLEN bull:ingestion:active 2>/dev/null || echo 0)"
active="${active//[^0-9]/}"
if [[ "${active:-0}" -gt 0 ]]; then
    log "a document is being ingested ($active active job); will retry next round"
    exit 0
fi

if $DRY_RUN; then
    log "dry run: would fast-forward to ${remote_rev:0:7}, build the client into $WEB_ROOT/releases/${remote_rev:0:7} and rebuild: ${SERVICES[*]}"
    exit 0
fi

if [[ ! -w "$WEB_ROOT" ]]; then
    log "$WEB_ROOT is missing or not writable; create it (cloud.md \"4. nginx\")"
    exit 1
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

# Build in a throwaway Node container, so the host needs no Node. The checkout
# is mounted read-only and copied inside, so node_modules/ and dist/ never land
# in it (they'd stop the next --ff-only). Runs as this user, so later rounds
# can delete old releases.
release="$WEB_ROOT/releases/${remote_rev:0:7}"
staging="$WEB_ROOT/releases/.staging"
rm -rf "$staging" && mkdir -p "$staging" "$WEB_ROOT/assets" "$HOME/.cache/a2603-npm"
log "building the client"
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$REPO/client:/src:ro" -v "$staging:/out" -v "$HOME/.cache/a2603-npm:/tmp/.npm" \
    node:26-alpine sh -c 'cp -r /src /tmp/app && cd /tmp/app && rm -rf node_modules dist \
        && npm ci --no-audit --no-fund && npm run build && cp -r dist/. /out'
rm -rf "$release" && mv "$staging" "$release"
# Shared assets: new files are added, old ones stay, so a page loaded before
# this deploy can still fetch the lazily loaded chunks it expects. Touch this
# release's files so the age-based cleanup below never removes them.
cp -rn "$release/assets/." "$WEB_ROOT/assets/"
(cd "$release/assets" && find . -type f -print0) | (cd "$WEB_ROOT/assets" && xargs -0 -r touch --)

log "building and restarting: ${SERVICES[*]}"
docker compose up -d --build "${SERVICES[@]}"

# Switch nginx to the new release in one step (rename is atomic).
ln -sfn "releases/${remote_rev:0:7}" "$WEB_ROOT/current.new"
mv -Tf "$WEB_ROOT/current.new" "$WEB_ROOT/current"

ls -1dt "$WEB_ROOT"/releases/*/ | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf
find "$WEB_ROOT/assets" -type f -mtime +"$ASSET_DAYS" -delete
docker image prune -f >/dev/null
echo "$remote_rev" > "$STATE_FILE"
log "deployed ${remote_rev:0:7}"
