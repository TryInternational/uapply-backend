# Moving the API from App Engine Flex to Cloud Run (Doha, me-central1)

Why: almost all of the back office's waiting time is network distance. Every API
call from Kuwait to the current App Engine region costs ~0.35–0.4 s before the
server does any work. Running the API **and the database** in Doha
(`me-central1`) cuts that to a few tens of milliseconds. Kubernetes would not
change it; the region does.

Nothing in this folder runs by itself. You run every step, in order, and every
step up to the DNS switch (step 6) is invisible to users. App Engine stays
untouched the whole time, so going back is a DNS change.

| What | Where it lives |
| --- | --- |
| Image recipe (no `.env` inside) | `deploy/cloudrun/Dockerfile`, `cloudbuild.yaml`, `.gcloudignore` |
| One file per Cloud Run service | `deploy/cloudrun/services/*.yaml` |
| Build / deploy / rollback | `deploy/cloudrun/deploy.sh` |
| Custom domains (HTTPS load balancer) | `deploy/cloudrun/load-balancer.sh` |
| CI example (not active) | `deploy/cloudrun/github-workflow.example.yml` |

Services and the domains they keep:

| Cloud Run service | Settings file | Domain | App Engine today |
| --- | --- | --- | --- |
| `uapply-staging-api` | `.env.staging` | `staging.api.uapplyabroad.com` | `staging.yaml` |
| `uapply-api` | `.env.production` | `api.uapplyabroad.com` | `production.yaml` |
| `ulearn-api` | `.env.production` | `api.ulearn.study` | `ulearn-production.yaml` |

`ulearn-api` runs the same code against the **same production database** as
`uapply-api`, so the two move together (step 9).

---

## What changed in the code (safe for App Engine too)

* `src/config/config.js` reads the settings file from `ENV_FILE` when that is
  set (Cloud Run mounts the Secret Manager copy there). Unset → the repo-root
  `.env.<APP_ENV>`, exactly as before. Variables set on the service always win
  over the file.
* `src/app.js` has an off-by-default `GET /v1/_ip` (only when
  `DEBUG_IP_ECHO=true`) to check client IPs behind the load balancer (step 7).
* The App Engine `Dockerfile`, `*.yaml` and the GitHub workflow are unchanged.

## How it is set up, and why

* **Region `me-central1` (Doha).** Closest Google region to Kuwait.
* **One warm instance, never more** (`minScale 1`, `maxScale 1`). No cold
  starts. Not more than one because Socket.IO keeps its rooms in memory, so a
  notification emitted on instance A never reaches a browser connected to B.
  Production runs one instance on App Engine today, so this is not a
  downgrade. See [Scaling past one instance](#scaling-past-one-instance).
* **CPU always on** (`cpu-throttling: false`). The API keeps working after it
  answers (Slack, notifications) and holds WebSockets open.
* **Session affinity on, 60-minute request timeout.** WebSockets are
  requests on Cloud Run, so one lives at most 60 min; socket.io-client
  reconnects by itself.
* **Settings from Secret Manager**, mounted as a file. The image contains no
  `.env`, so it can be built anywhere (Cloud Build, CI) without the secrets.
* **Plain `node src/index.js`.** Cloud Run restarts a crashed container
  itself, so pm2 and nodemon are not needed (staging no longer runs nodemon in
  production).
* **A global HTTPS load balancer for the domains.** Cloud Run cannot map
  custom domains itself in the Middle East regions. The load balancer also
  lets the certificate be issued *before* the switch, so the switch has no
  downtime.

---

## 0. Before you start

1. **gcloud** installed and signed in with an account that owns the project:
   ```sh
   gcloud auth login
   gcloud config set project digital-vim-270607
   ```
2. **Where is the database?** Moving the API without the database makes
   things *slower*: every query would cross from Doha to the database's region.
   * In MongoDB Atlas, open each cluster (staging, production) and note
     provider and region.
   * Atlas offers GCP `me-central1` (Doha) for dedicated clusters (M10 and
     up). Check in Atlas that it is offered for your tier before planning on it.
   * Until the database moves, run only staging on Cloud Run and compare.
3. **Atlas IP access list.** Cloud Run calls the database from changing
   Google IPs. If the list is already `0.0.0.0/0` (usual with App Engine Flex,
   whose IPs also change), nothing to do. If it lists fixed IPs, you need either
   a static outbound IP (Direct VPC egress + Cloud NAT) or Atlas Private Service
   Connect. Settle this before step 3.
4. **Org policy.** The API must be publicly callable (browsers call it).
   `deploy.sh` grants `allUsers` the invoker role. If your organisation
   enforces *Domain restricted sharing*
   (`constraints/iam.allowedPolicyMemberDomains`), that grant fails; an org
   admin must allow it for this project.
5. **DNS access.** Find where `uapplyabroad.com` and `ulearn.study` are
   managed, and **write down the current records** for the three API
   hostnames (A/AAAA or CNAME to `ghs.googlehosted.com`). Those records are
   your rollback.

## 1. One-time project setup

```sh
./deploy/cloudrun/deploy.sh setup
```
This enables the APIs (Cloud Run, Artifact Registry, Cloud Build, Secret
Manager, Compute, Certificate Manager), creates the image repository `uapply`
in `me-central1`, and creates the service account
`uapply-api-run@digital-vim-270607.iam.gserviceaccount.com`. The API runs as
that account; it can write logs, traces and metrics, and nothing else.

## 2. Upload the settings

```sh
./deploy/cloudrun/deploy.sh secret uapply-staging-api .env.staging
```
This stores the file as the secret `uapply-staging-api-env` and lets only the
API's service account read it. The file stays on your machine. Re-run the
same command whenever `.env.staging` changes, then re-deploy (step 3) so the
service picks up the new version.

Notes on the settings:
* `PORT`, `NODE_ENV`, `APP_ENV` and `TRUST_PROXY_HOPS` are set on the service
  and override the file. A `PORT=3000` in the file is harmless.
* The Firebase / Google service-account keys in the file keep working as
  they are.

## 3. Build and deploy staging

```sh
./deploy/cloudrun/deploy.sh release uapply-staging-api
```
* **Build.** Cloud Build builds the image from your working copy (the
  `.env*` files are never uploaded) and tags it with the git commit
  (`-dirty-<time>` when you have uncommitted changes).
* **Deploy.** It deploys the image and prints the service's
  `https://uapply-staging-api-….run.app` address.
* **Startup time.** The first start takes up to ~2 minutes: the API only
  starts listening once MongoDB is connected and the roles are loaded.

If the build fails with a permission error on pushing the image, grant the
Cloud Build service account *Artifact Registry Writer* on the `uapply`
repository. Newer projects build as the Compute default service account,
which may lack it.

Logs: Cloud Console → Cloud Run → `uapply-staging-api` → Logs, or
```sh
gcloud run services logs read uapply-staging-api --region=me-central1 --limit=100
```

## 4. Test on the run.app address

```sh
URL=$(./deploy/cloudrun/deploy.sh url uapply-staging-api)
curl -s -w '  %{http_code} %{time_total}s\n' "$URL/v1/ping"
# {"code":404,"message":"Not found"} = the API is up (an unknown path, answered by the API itself)
```
To use the real back office against it without touching DNS, run the
frontend locally with `REACT_APP_API_ENDPOINT=$URL/v1` and
`REACT_APP_API_URL=$URL`. Then:

* Log in, open the dashboard, Students, a student profile, Leads and Fees.
* Check that notifications arrive live (the WebSocket). Open DevTools →
  Network → WS: the connection should be to the run.app host.
* Compare the request times with the current staging. The gain only shows
  fully once the database is in Doha too.

CORS: `http://localhost:3001` and the two back-office domains are already
allowed, so this works without code changes.

## 5. Put the domain on the load balancer (no traffic moves yet)

```sh
./deploy/cloudrun/load-balancer.sh add uapply-staging-api staging.api.uapplyabroad.com
```
* **First run.** It creates the shared load balancer once: a global IP,
  HTTPS on 443, and an http→https redirect on 80. Then it creates a
  backend for the service and a Google-managed certificate for the domain.
* **Output.** It ends by printing:
  * the load balancer IP;
  * a **CNAME** record, `_acme-challenge.staging.api.uapplyabroad.com` → `….authorize.certificatemanager.goog.`

Add that CNAME at your DNS provider. It only proves you own the domain; it
does not move any traffic. Then wait until the certificate shows `ACTIVE`
(minutes to an hour):
```sh
./deploy/cloudrun/load-balancer.sh status
```
You can test the load balancer before switching by pinning the name to its IP
on your own machine:
```sh
curl -s --resolve staging.api.uapplyabroad.com:443:<LB_IP> https://staging.api.uapplyabroad.com/v1/ping
# {"code":404,"message":"Not found"} = load balancer, certificate and API all work
```

## 6. Switch staging (the cut-over)

At your DNS provider, for `staging.api.uapplyabroad.com`:
* Replace the current records with a single **A** record → the load
  balancer IP. Use a short TTL (300 s) for the first days.
* **Delete any AAAA records.** They point at App Engine, and IPv6 users
  would keep landing there.

Within the TTL, browsers reach Cloud Run. App Engine keeps running, untouched.
The staging frontend needs no change: same domain, same CORS.

## 7. Check client IPs, then lock the run.app address

The API trusts `TRUST_PROXY_HOPS=2` proxies (load balancer + Cloud Run's front
end) when it reads the caller's IP (rate limits, logs). To confirm it once:
```sh
gcloud run services update uapply-staging-api --region=me-central1 --update-env-vars=DEBUG_IP_ECHO=true
curl -s https://staging.api.uapplyabroad.com/v1/_ip      # "ip" must be YOUR public IP (compare: curl ifconfig.me)
gcloud run services update uapply-staging-api --region=me-central1 --remove-env-vars=DEBUG_IP_ECHO
```
* If `ip` shows a Google address instead, set the value in
  `services/<service>.yaml` to `3`.
* If it shows an address you did not send, set it to `1`.
* After either change, re-deploy.

Then close the side door, so the API is reachable only through the domain:
```sh
./deploy/cloudrun/deploy.sh lock uapply-staging-api
```
(`unlock` reopens the run.app address; later deploys keep whichever setting the
service has.)

Run staging like this for a few days before step 9.

## 8. Day-to-day deploys

```sh
./deploy/cloudrun/deploy.sh release uapply-staging-api     # build + deploy current code
./deploy/cloudrun/deploy.sh rollback uapply-staging-api    # instantly back to the previous revision
```
Or with npm: `npm run cloudrun:staging` / `cloudrun:production` /
`cloudrun:ulearn`.

A deploy starts the new revision, waits for it to listen, then moves traffic.
Open WebSockets on the old revision drop and reconnect within seconds.

Note: the current GitHub workflow still deploys **App Engine** on every push to
`develop`/`master`. That is useful while App Engine is the fallback. Switch CI
over only after step 10
(`deploy/cloudrun/github-workflow.example.yml` shows how).

## 9. Production and uLearn (together with the database move)

Do this only once the production database is in Doha (or you have decided to
move it in the same window). `uapply-api` and `ulearn-api` share that
database, so both move with it:

```sh
./deploy/cloudrun/deploy.sh secret  uapply-api .env.production
./deploy/cloudrun/deploy.sh secret  ulearn-api .env.production
./deploy/cloudrun/deploy.sh release uapply-api
./deploy/cloudrun/deploy.sh release ulearn-api
# test both run.app addresses (step 4), then:
./deploy/cloudrun/load-balancer.sh add uapply-api api.uapplyabroad.com
./deploy/cloudrun/load-balancer.sh add ulearn-api api.ulearn.study
# add the two _acme-challenge CNAMEs, wait for ACTIVE (load-balancer.sh status)
```

Database move (Atlas, outline):
1. Create the new cluster in GCP `me-central1`, same version and tier or larger.
2. Copy the data. Choose one:
   * Atlas Live Migration or `mongosync` (near-zero downtime);
   * `mongodump`/`mongorestore` in a short quiet window.
3. Run `deploy.sh secret …` with the **new** connection string in
   `.env.production`, and `release` both services again.
4. Switch the DNS for `api.uapplyabroad.com` and `api.ulearn.study` to the
   load balancer IP (A record, delete AAAA), as in step 6.
5. Stop writes to the old cluster (keep it until you are sure).

Important: once Cloud Run writes to the new cluster, the App Engine
production services still point at the old one. From then on, rolling back
DNS to App Engine also needs `.env.production` on App Engine pointed at the
new cluster (and an App Engine deploy). Plan the window so either side can
serve.

Then check IPs and lock, as in step 7, for both services.

## 10. Retire App Engine (after a week or two)

When nothing has needed a rollback:
* Stop the three App Engine services. In the Console: App Engine → Versions
  → stop, or `gcloud app versions stop`. Stopped Flex versions no longer run VMs.
  Delete them later.
* `dispatch.yaml` still routes the other ulearn hostnames
  (`ulearn.study`, `staging.ulearn.study`, `staging-api.ulearn.study`).
  **Leave it and those services alone**; only the three API hostnames moved.
* Switch CI to Cloud Run (`github-workflow.example.yml`).
* Raise the DNS TTLs back to normal.

---

## Rollback

| Situation | Do this | Takes |
| --- | --- | --- |
| A bad deploy | `deploy.sh rollback <service>` | seconds |
| Cloud Run itself is the problem | Put the DNS records you wrote down in step 0 back (App Engine is still running) | the DNS TTL |
| Need the run.app address again | `deploy.sh unlock <service>` | seconds |

## Costs (check the pricing calculator for me-central1)

* **Instances.** Each service keeps one always-on instance (1 vCPU;
  1 GiB staging, 2 GiB production). me-central1 is a Tier 2 region, priced
  above US regions. This replaces the App Engine Flex VMs, which are also
  always on today. To save on staging, you can later drop its `minScale`
  to `0` (with cold starts of a few seconds).
* **Load balancer.** The forwarding rules (shared by all three domains)
  are a fixed hourly charge, roughly $18/month, plus a small per-GB data
  charge.
* **Secret Manager, Artifact Registry, Cloud Build.** Negligible at this
  size. Delete old images now and then, or add a cleanup policy on the
  `uapply` repository.

## Scaling past one instance

`maxScale` is 1 because of Socket.IO. To run more instances:
1. Create a Memorystore for Redis instance in `me-central1`, and give the
   services Direct VPC egress to reach it.
2. Add `@socket.io/redis-adapter` in `src/index.js`
   (`io.adapter(createAdapter(pub, sub))`), so emits reach every instance.
3. Raise `maxScale` in `services/*.yaml`. Keep session affinity on.

The in-memory response cache (`middlewares/responseCache.js`) is per
instance; that is fine (each instance caches for 60 s).

## Limits worth knowing

* **Request body: 32 MiB** (uploads are held in memory by multer). Same as
  App Engine.
* **Request / WebSocket lifetime: 60 minutes.**
* **Shutdown.** The container gets 10 s after SIGTERM. The API stops
  accepting connections on SIGTERM; open sockets reconnect to the new
  revision.
