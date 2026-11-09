#!/usr/bin/env bash
# Cloud Run deploys for the uapply / ulearn API.  Run from anywhere; the
# script works from the repo root.  Needs gcloud, signed in to an account that
# can administer the project.  Nothing here touches App Engine.
#
#   ./deploy/cloudrun/deploy.sh setup                          one-time: APIs, image repo, service account
#   ./deploy/cloudrun/deploy.sh secret  <service> <env-file>   upload / update that service's settings
#   ./deploy/cloudrun/deploy.sh release <service>              build the image and deploy it
#   ./deploy/cloudrun/deploy.sh deploy  <service> <image>      deploy an image that is already built
#   ./deploy/cloudrun/deploy.sh url     <service>              print the service's *.run.app address
#   ./deploy/cloudrun/deploy.sh lock    <service>              only the load balancer may reach it
#   ./deploy/cloudrun/deploy.sh unlock  <service>              the *.run.app address works again
#   ./deploy/cloudrun/deploy.sh rollback <service>             send traffic back to the previous revision
#
# <service> is one of: uapply-staging-api  uapply-api  ulearn-api
# Override the defaults with PROJECT=… REGION=… if you need to.
set -euo pipefail

PROJECT="${PROJECT:-digital-vim-270607}"
REGION="${REGION:-me-central1}"            # Doha
REPO="${REPO:-uapply}"                     # Artifact Registry repository
SA_NAME="${SA_NAME:-uapply-api-run}"
SA_EMAIL="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
SERVICES="uapply-staging-api uapply-api ulearn-api"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
gc() { gcloud --project="$PROJECT" "$@"; }

need_service() {
  local s="${1:-}"
  [[ -n "$s" ]] || die "name a service: $SERVICES"
  [[ " $SERVICES " == *" $s "* ]] || die "unknown service '$s' (expected one of: $SERVICES)"
  [[ -f "$HERE/services/$s.yaml" ]] || die "missing $HERE/services/$s.yaml"
}

image_for() {
  local tag
  tag="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M%S)"
  # uncommitted changes get their own tag so a re-deploy never reuses an old image
  if ! git diff --quiet 2>/dev/null; then tag="${tag}-dirty-$(date +%H%M%S)"; fi
  echo "${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/api:${tag}"
}

cmd_setup() {
  say "Enabling the APIs the setup uses"
  gc services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
    secretmanager.googleapis.com compute.googleapis.com certificatemanager.googleapis.com

  say "Image repository ${REPO} in ${REGION}"
  gc artifacts repositories describe "$REPO" --location="$REGION" >/dev/null 2>&1 ||
    gc artifacts repositories create "$REPO" --repository-format=docker --location="$REGION" \
      --description="uapply / ulearn API images"

  say "Service account ${SA_EMAIL} (the identity the API runs as)"
  gc iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1 ||
    gc iam service-accounts create "$SA_NAME" --display-name="uapply API on Cloud Run"
  # write logs and traces like the App Engine service did
  for role in roles/logging.logWriter roles/cloudtrace.agent roles/monitoring.metricWriter; do
    gc projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:${SA_EMAIL}" \
      --role="$role" --condition=None >/dev/null
  done
  say "Done. Next: deploy.sh secret <service> <env-file>"
}

cmd_secret() {
  local svc="$1" file="${2:-}"
  need_service "$svc"
  [[ -n "$file" && -f "$file" ]] || die "give the settings file, e.g. .env.staging"
  local name="${svc}-env"
  say "Uploading $file as secret ${name} (the file itself stays on this machine)"
  if gc secrets describe "$name" >/dev/null 2>&1; then
    gc secrets versions add "$name" --data-file="$file"
  else
    gc secrets create "$name" --replication-policy=automatic --data-file="$file"
  fi
  gc secrets add-iam-policy-binding "$name" --member="serviceAccount:${SA_EMAIL}" \
    --role=roles/secretmanager.secretAccessor >/dev/null
  say "Stored. A running service picks up a new version on its next deploy (deploy.sh release ${svc})."
}

cmd_build() {
  local image="$1"
  say "Building ${image} with Cloud Build"
  # deploy/cloudrun/.gcloudignore keeps the .env files out of the upload
  gc builds submit --config="deploy/cloudrun/cloudbuild.yaml" \
    --ignore-file="deploy/cloudrun/.gcloudignore" \
    --substitutions="_IMAGE=${image}" .
}

render() {
  local svc="$1" image="$2" ingress="$3"
  sed -e "s|\${IMAGE}|${image}|g" \
      -e "s|\${SERVICE_ACCOUNT}|${SA_EMAIL}|g" \
      -e "s|\${REGION}|${REGION}|g" \
      -e "s|\${INGRESS}|${ingress}|g" \
      "$HERE/services/$svc.yaml"
}

current_ingress() {
  gc run services describe "$1" --region="$REGION" \
    --format='value(metadata.annotations."run.googleapis.com/ingress")' 2>/dev/null || true
}

cmd_deploy() {
  local svc="$1" image="${2:-}"
  need_service "$svc"
  [[ -n "$image" ]] || die "give the image to deploy (or use: deploy.sh release ${svc})"
  # keep whatever ingress the service already has (a locked service stays locked)
  local ingress
  ingress="$(current_ingress "$svc")"
  ingress="${ingress:-all}"
  local tmp
  tmp="$(mktemp)"
  render "$svc" "$image" "$ingress" >"$tmp"
  say "Deploying ${svc} → ${REGION} (ingress: ${ingress})"
  gc run services replace "$tmp" --region="$REGION"
  rm -f "$tmp"
  # The API is public (the back office, the portals and the lead forms call it
  # from browsers); its own JWT checks decide who may do what.
  gc run services add-iam-policy-binding "$svc" --region="$REGION" \
    --member=allUsers --role=roles/run.invoker >/dev/null
  cmd_url "$svc"
}

cmd_release() {
  local svc="$1"
  need_service "$svc"
  local image
  image="$(image_for)"
  cmd_build "$image"
  cmd_deploy "$svc" "$image"
}

cmd_url() {
  need_service "$1"
  gc run services describe "$1" --region="$REGION" --format='value(status.url)'
}

cmd_lock() {
  need_service "$1"
  say "${1}: only the load balancer may reach it now"
  gc run services update "$1" --region="$REGION" --ingress=internal-and-cloud-load-balancing
}

cmd_unlock() {
  need_service "$1"
  gc run services update "$1" --region="$REGION" --ingress=all
}

cmd_rollback() {
  need_service "$1"
  local prev
  prev="$(gc run revisions list --service="$1" --region="$REGION" \
    --sort-by='~metadata.creationTimestamp' --format='value(metadata.name)' --limit=2 | sed -n 2p)"
  [[ -n "$prev" ]] || die "no earlier revision of $1"
  say "Sending all of ${1}'s traffic to ${prev}"
  gc run services update-traffic "$1" --region="$REGION" --to-revisions="${prev}=100"
}

case "${1:-}" in
  setup) cmd_setup ;;
  secret) cmd_secret "${2:-}" "${3:-}" ;;
  release) cmd_release "${2:-}" ;;
  deploy) cmd_deploy "${2:-}" "${3:-}" ;;
  url) cmd_url "${2:-}" ;;
  lock) cmd_lock "${2:-}" ;;
  unlock) cmd_unlock "${2:-}" ;;
  rollback) cmd_rollback "${2:-}" ;;
  *) sed -n '2,17p' "$0"; exit 1 ;;
esac
