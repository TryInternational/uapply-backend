#!/usr/bin/env bash
# One shared HTTPS load balancer in front of the Cloud Run API services, so the
# existing domains (api.uapplyabroad.com, staging.api.uapplyabroad.com,
# api.ulearn.study) keep working. Cloud Run cannot map a custom domain itself
# in the Middle East regions, hence the load balancer.
#
#   ./deploy/cloudrun/load-balancer.sh add <service> <domain>   route <domain> to <service> (+ its certificate)
#   ./deploy/cloudrun/load-balancer.sh status                   certificates, DNS records to add, the IP
#
# Zero-downtime order (README steps 5–6):
#   1. add            — creates everything; prints a CNAME (_acme-challenge…) to add in DNS
#   2. add that CNAME — the certificate is issued while the domain still points at App Engine
#   3. status         — wait until the certificate is ACTIVE
#   4. switch the domain's DNS to the load balancer IP (an A record) — the cut-over
#   5. switching the A record back to App Engine is the rollback
set -euo pipefail

PROJECT="${PROJECT:-digital-vim-270607}"
REGION="${REGION:-me-central1}"
LB="${LB:-uapply-api-lb}"            # prefix for the shared pieces
IP_NAME="${LB}-ip"
CERT_MAP="${LB}-certs"
URL_MAP="${LB}-urls"
REDIRECT_MAP="${LB}-http-redirect"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
gc() { gcloud --project="$PROJECT" "$@"; }
exists() { "$@" >/dev/null 2>&1; }
slug() { echo "$1" | tr '.' '-' | tr -cd 'a-z0-9-'; }

ensure_shared() {
  local first_backend="$1"
  exists gc compute addresses describe "$IP_NAME" --global ||
    gc compute addresses create "$IP_NAME" --network-tier=PREMIUM --ip-version=IPV4 --global
  exists gc certificate-manager maps describe "$CERT_MAP" ||
    gc certificate-manager maps create "$CERT_MAP"
  # the URL map needs a default backend; the first service added becomes it
  exists gc compute url-maps describe "$URL_MAP" --global ||
    gc compute url-maps create "$URL_MAP" --default-service="$first_backend" --global
  exists gc compute target-https-proxies describe "${LB}-https" --global ||
    gc compute target-https-proxies create "${LB}-https" --url-map="$URL_MAP" \
      --certificate-map="$CERT_MAP" --global
  exists gc compute forwarding-rules describe "${LB}-443" --global ||
    gc compute forwarding-rules create "${LB}-443" --load-balancing-scheme=EXTERNAL_MANAGED \
      --network-tier=PREMIUM --address="$IP_NAME" --target-https-proxy="${LB}-https" --global --ports=443
  # plain http:// is redirected to https:// on the same IP
  if ! exists gc compute url-maps describe "$REDIRECT_MAP" --global; then
    local spec
    spec="$(mktemp)"
    cat >"$spec" <<YAML
name: ${REDIRECT_MAP}
defaultUrlRedirect:
  httpsRedirect: true
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
YAML
    gc compute url-maps import "$REDIRECT_MAP" --global --quiet --source="$spec"
    rm -f "$spec"
  fi
  exists gc compute target-http-proxies describe "${LB}-http" --global ||
    gc compute target-http-proxies create "${LB}-http" --url-map="$REDIRECT_MAP" --global
  exists gc compute forwarding-rules describe "${LB}-80" --global ||
    gc compute forwarding-rules create "${LB}-80" --load-balancing-scheme=EXTERNAL_MANAGED \
      --network-tier=PREMIUM --address="$IP_NAME" --target-http-proxy="${LB}-http" --global --ports=80
}

cmd_add() {
  local svc="${1:-}" domain="${2:-}"
  [[ -n "$svc" && -n "$domain" ]] || die "usage: load-balancer.sh add <service> <domain>"
  local neg="${svc}-neg" backend="${svc}-backend" d
  d="$(slug "$domain")"

  say "Backend for ${svc} (serverless NEG in ${REGION})"
  exists gc compute network-endpoint-groups describe "$neg" --region="$REGION" ||
    gc compute network-endpoint-groups create "$neg" --region="$REGION" \
      --network-endpoint-type=serverless --cloud-run-service="$svc"
  if ! exists gc compute backend-services describe "$backend" --global; then
    gc compute backend-services create "$backend" --load-balancing-scheme=EXTERNAL_MANAGED --global
    gc compute backend-services add-backend "$backend" --global \
      --network-endpoint-group="$neg" --network-endpoint-group-region="$REGION"
  fi

  say "Shared load balancer pieces"
  ensure_shared "$backend"

  say "Certificate for ${domain} (DNS authorization, so it is issued before the switch)"
  exists gc certificate-manager dns-authorizations describe "${d}-auth" ||
    gc certificate-manager dns-authorizations create "${d}-auth" --domain="$domain"
  exists gc certificate-manager certificates describe "${d}-cert" ||
    gc certificate-manager certificates create "${d}-cert" --domains="$domain" \
      --dns-authorizations="${d}-auth"
  exists gc certificate-manager maps entries describe "${d}-entry" --map="$CERT_MAP" ||
    gc certificate-manager maps entries create "${d}-entry" --map="$CERT_MAP" \
      --certificates="${d}-cert" --hostname="$domain"

  say "Route ${domain} → ${svc}"
  if gc compute url-maps describe "$URL_MAP" --global --format=json | grep -q "\"${domain}\""; then
    echo "already routed"
  else
    gc compute url-maps add-path-matcher "$URL_MAP" --global --path-matcher-name="${d}" \
      --default-service="$backend" --new-hosts="$domain"
  fi

  cmd_status
}

cmd_status() {
  say "Load balancer IP (the A record each domain points at for the cut-over)"
  gc compute addresses describe "$IP_NAME" --global --format='value(address)' 2>/dev/null || echo "(not created yet)"
  say "Certificates (wait for ACTIVE before switching a domain)"
  gc certificate-manager certificates list --format='table(name,managed.domains.list(),managed.state)' 2>/dev/null || true
  say "DNS records to add now (they do not move any traffic)"
  gc certificate-manager dns-authorizations list \
    --format='table(domain,dnsResourceRecord.name,dnsResourceRecord.type,dnsResourceRecord.data)' 2>/dev/null || true
}

case "${1:-}" in
  add) cmd_add "${2:-}" "${3:-}" ;;
  status) cmd_status ;;
  *) sed -n '2,17p' "$0"; exit 1 ;;
esac
