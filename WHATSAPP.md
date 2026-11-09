# WhatsApp Business (Meta Cloud API) — backend module

Self-hosted WhatsApp integration (the way Twilio/WATI work, but on our own
backend + Meta Cloud API). Implements the `/v1/whatsapp/*` REST + `wa:*` socket
contract the CRM frontend inbox already speaks. Runs in **stub mode** with no
credentials so you can develop/test before a Meta account exists; add the env
vars to go live with **no code change**.

## What was added

- `src/models/whatsappConversation.model.js`, `src/models/whatsappMessage.model.js`
- `src/thirdparty/whatsapp.js` — Meta Graph API client (stubs when creds absent)
- `src/services/whatsapp.services.js` — inbound/outbound + queries + DTOs
- `src/controllers/whatsapp.controller.js`, `src/routes/v1/whatsapp.route.js`,
  `src/validations/whatsapp.validation.js`
- Registered in the model/service/controller barrels + `routes/v1/index.js`
  (`{ path: '/whatsapp' }`)
- `src/config/config.js` — `config.whatsapp` block + Joi env keys (all optional)
- `src/app.js` — captures `req.rawBody` for Meta signature verification
- `src/thirdparty/firebase.js` — `uploadBuffer()` for storing inbound media
- `multer` dependency (memory storage) for the `/media` upload endpoint

## Endpoints (all under `/v1/whatsapp`, JWT-authenticated except the webhook)

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/webhook` | Meta verification + inbound events (public) |
| GET | `/conversations` | list (`filter=mine\|unassigned\|all`, `search`, paginated) |
| GET | `/conversations/:id` | one conversation |
| POST | `/conversations/:id/read` | clear unread |
| POST | `/conversations/:id/assign` | reassign (writes through to `student.assignedTo`) |
| GET | `/conversations/:id/messages` | thread (`before` cursor, `limit`) |
| POST | `/conversations/:id/messages/text` | send text (409 `{code:"WINDOW_CLOSED"}` outside 24h) |
| POST | `/conversations/:id/messages/template` | send template (allowed anytime) |
| POST | `/conversations/:id/messages/media` | send media |
| POST | `/conversations/:id/messages/voice` | send a voice note (multipart `file`) |
| POST | `/conversations/:id/notes` | add an internal note (staff-only, not sent to WhatsApp) |
| PATCH | `/conversations/:id` | update tags / priority / status (resolve/reopen) / next follow-up |
| POST | `/media` | upload a file → media reference |
| GET | `/templates` | approved templates |
| GET | `/analytics/overview` | dashboard KPIs, messages-by-hour, messages-per-day, funnel, waiting list (`?range=today\|7d\|30d`) |
| GET | `/analytics/team` | per-counselor performance + team totals (`?range=…`) |
| GET | `/integration` | setup diagnostics: stub/live mode, which creds are set (booleans, no secrets), the webhook URL to paste into Meta, and what's still missing |

Socket events emitted to each assignee's `userId` room (reusing the existing
`subscribe` mechanism): `wa:message:new`, `wa:message:status`,
`wa:conversation:window`, `wa:conversation:assigned`.

## Run it now (no WABA yet)

Everything works against MongoDB in **stub mode** — outbound sends are no-ops
that still persist, inbound needs WABA. To see the inbox + dashboards populated:

```
# 1. start the backend (uses your .env.<APP_ENV>)
npm run dev

# 2. seed demo conversations/messages/students (safe, idempotent — uses +96550-000-0xx phones)
APP_ENV=development node scripts/seedWhatsapp.js

# 3. run the frontend — REACT_APP_WHATSAPP_MOCK is now "false" in all envs, so the
#    CRM inbox (/inbox) and Dashboard "WhatsApp" tab pull from THIS backend.
```

The frontend expects the backend at `REACT_APP_API_ENDPOINT` (dev:
`http://localhost:3000/v1`) and the socket at `REACT_APP_API_URL`. Ensure the
frontend origin is in the socket CORS allow-list in `src/index.js`.

When you later add the 5 WABA env vars + configure the webhook (see below),
outbound goes live and real inbound messages flow in through the same code —
no code change, `isLive()` flips on.

## Env (add to `.env` / `.env.staging` / `.env.production`)

```
WHATSAPP_PHONE_NUMBER_ID=      # Meta phone number id
WHATSAPP_TOKEN=                # permanent access token
WHATSAPP_WABA_ID=              # WhatsApp Business Account id (for templates)
WHATSAPP_WEBHOOK_VERIFY_TOKEN= # any secret; echoed on the GET verify challenge
WHATSAPP_APP_SECRET=           # Meta app secret (verifies X-Hub-Signature-256)
WHATSAPP_API_VERSION=v21.0
WHATSAPP_MEDIA_BUCKET=         # Firebase/GCS bucket for inbound media (defaults to <project>.appspot.com)
```

Leave `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` blank → **stub mode**: no
real Meta calls, outbound returns fake ids, `/templates` returns a static
approved set. Everything else (conversations, persistence, sockets, 24h window)
works for real.

## Test locally (stub mode, no Meta account)

1. `npm run dev` (needs Mongo + the existing `.env`).
2. Webhook verify:
   ```
   curl "http://localhost:3000/v1/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=$WHATSAPP_WEBHOOK_VERIFY_TOKEN&hub.challenge=123"
   # → 123
   ```
3. Simulate an inbound message (phone should match a real student's `phoneNo`):
   ```
   curl -X POST http://localhost:3000/v1/whatsapp/webhook \
     -H 'Content-Type: application/json' \
     -d '{"object":"whatsapp_business_account","entry":[{"changes":[{"value":{
       "messaging_product":"whatsapp",
       "contacts":[{"profile":{"name":"Ahmed Khan"},"wa_id":"971501112233"}],
       "messages":[{"from":"971501112233","id":"wamid.TEST1","timestamp":"1710000000","type":"text","text":{"body":"Hi, is the UK intake still open?"}}]
     }}]}]}'
   ```
   → creates a `WhatsappConversation` + inbound `WhatsappMessage`, resolves the
   student's assignees, and emits `wa:message:new` to each assignee's socket room.
   (When `WHATSAPP_APP_SECRET` is set, add a valid `X-Hub-Signature-256` header.)
4. Point the frontend at it: set `REACT_APP_WHATSAPP_MOCK=false` in the CRM
   `.env.dev`; `/whatsapp/*` resolves to `/v1/whatsapp/*` via
   `REACT_APP_API_ENDPOINT`. Log in as the assigned counselor and open `/inbox`.

## Go live (Meta configuration)

1. Create a Meta app + WhatsApp Business Account; get the phone number id + a
   permanent token; fill the env vars.
2. In the Meta app WhatsApp → Configuration, set the **Callback URL** to
   `https://<your-host>/v1/whatsapp/webhook` and the **Verify token** to
   `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; subscribe to the **messages** field.
3. Ensure the frontend origin is allowed in the socket CORS list in
   `src/index.js` (the socket server keeps its own origin allow-list).

## Not included yet (frontend keeps mock ON for these tabs)

- **Broadcasts** (`/broadcasts`, `/audience-segments`) — needs a rate-limited
  background template sender + `wa:broadcast:progress` emits.
- **Calling** (`/call-permission`, `/calls`) — needs Meta Business Calling access
  + a WebRTC SDP proxy; see the frontend `docs/whatsapp-calling-api.md`.
- **Auth hardening**: endpoints use `auth()` (any authenticated user). Swap to a
  `'manageWhatsapp'` right once added to role docs. The socket server currently
  trusts any `subscribe` userId (pre-existing).

## Hardening (2026-10-19)

- **Idempotent inbound.** Meta retries a webhook until it gets a 2xx, so the same
  `wamid` can arrive more than once. `handleInboundMessages` skips a message
  whose `waMessageId` already exists, and `WhatsappMessage.waMessageId` is now a
  unique sparse index (sparse: internal notes have no wamid). If the collection
  already holds duplicates from before, the index build logs an error at boot —
  dedupe those rows first.
- **Receipts only move forward.** `sent → delivered → read`; a late `delivered`
  after `read` is ignored, `failed` always wins and keeps Meta's error code.
- **Graph errors are translated** (`thirdparty/whatsapp.js` axios interceptor)
  into `ApiError`s with a string `code`: `WINDOW_CLOSED` (131047, served as the
  409 the inbox expects), `NOT_ALLOWED_RECIPIENT` (131030 — test numbers),
  `TEMPLATE_PARAMS` / `TEMPLATE_NOT_FOUND`, `PHONE_NOT_REGISTERED`, `BAD_TOKEN`,
  `RATE_LIMITED`; anything else is `META_<code>` with Meta's message. The error
  middleware adds that string as `errorCode` next to the numeric HTTP `code`.
- `WHATSAPP_API_VERSION` defaults to `v25.0`.
- Unit test: `tests/unit/services/whatsapp.webhook.test.js` (models mocked, no DB).

## Added 2026-10-19 (demo prep)

- `POST /v1/whatsapp/conversations` `{phone, name?}` — start (or reopen) a
  conversation with a number from the CRM so staff can open with a template before
  the customer ever writes in. Links the student by phone when one matches and
  adds the caller as an assignee.
- `GET /v1/whatsapp/integration/phone` (admin) — live status of the configured
  number from Meta (name, quality, `status`, `platform_type`).
- `POST /v1/whatsapp/integration/phone/register` `{pin}` (admin) — registers the
  configured number with the Cloud API. Needed once per number (Meta error 133010
  `PHONE_NOT_REGISTERED` means it hasn't been done). The 6-digit PIN becomes the
  number's two-step verification PIN — Meta asks for the same one on any later
  re-registration, so keep it with the other WhatsApp secrets.

### Added 2026-10-21
- `PATCH /v1/whatsapp/conversations/:id` now accepts `contactName` (string, max 100). An empty string or `null` clears a staff-set name so the WhatsApp profile name / linked student is shown again.
- Onboarding note: after creating a WABA (test or real), subscribe the app to it or no webhooks reach the callback URL: `POST /{waba_id}/subscribed_apps` with the app's token. The dashboard's "Check test webhooks" shows events even when the app is not subscribed, which is misleading.

## Broadcasts (Phase 3) — added 2026-10-21
- `GET /v1/whatsapp/audience-segments` → `{ results: [{ key, label, estimatedRecipients, audience }] }`. "My students" for everyone; "All students" + per-stage segments for admins (stage segments scoped to own students for non-admins).
- `POST /v1/whatsapp/broadcasts` `{ templateName, language, audience: { studentIds? | filter: { assignedUserId?, stage?, nationality? } }, defaultComponents, audienceLabel? }` → 201 `Broadcast`. Non-admins are always scoped to their own students.
- `GET /v1/whatsapp/broadcasts` (paginated, own unless admin), `GET /v1/whatsapp/broadcasts/:id` (includes per-recipient status).
- Sending: in-process worker (`whatsappBroadcast.services.js`), ~6–7 msg/s, one normal outbound `WhatsappMessage` per recipient tagged with `broadcast`, so delivery receipts drive `counters` via the normal status webhook. Progress on socket `wa:broadcast:progress` `{ broadcastId, status, counters }` (emitted to all connected inbox users). `resumeStalled()` runs on boot to pick up broadcasts interrupted by a restart.
- Meta rules enforced here: templates only; recipients de-duplicated by phone; a failed send (e.g. 131030 on a test number) marks that recipient `failed` and the broadcast continues.

## Calling (Phase 4) — added 2026-10-21
- Prereqs on Meta: app subscribed to the `calls` webhook field (done); calling enabled on the phone number: `POST /v1/whatsapp/integration/calling/enable` (admin) or `POST /{phone_number_id}/settings { calling: { status: ENABLED, call_icon_visibility: DEFAULT, callback_permission_status: ENABLED } }`. Test numbers support calling (disabled by default). Business-initiated calls are not available to numbers in US/CA/EG/VN/NG.
- `GET /conversations/:id/call-permission` → `{ status: granted|pending|none, callHoursOpen }` (reads Meta `call_permissions`, caches on `conversation.callPermission`). `POST` sends the `call_permission_request` interactive message (24h window only; Meta caps 1/day, 2/week per user in production).
- `POST /conversations/:id/calls { sdpOffer }` → `WaCall` (browser WebRTC offer, complete ICE). Backend calls Meta `action=connect`; Meta's `connect` webhook carries the SDP answer → socket `wa:call:sdp { callId, sdpAnswer }`; statuses → `wa:call:status`. `POST /calls/:callId/terminate` hangs up. `GET /conversations/:id/calls` lists history.
- Inbound (user-initiated) calls are recorded as `missed` (no server-side auto-answer); the thread shows a system line. Permission replies (`call_permission_reply`) update the conversation and emit `wa:call:permission`.
- Frontend: `useWhatsAppCall` now opens the mic + `RTCPeerConnection`, waits for ICE gathering, applies the answer from `wa:call:sdp`, plays the remote track; the CallPanel state machine is unchanged.

## Token policy
Dashboard "temporary" tokens last 24h and are revoked whenever "Generate token" is clicked again. Use a **system-user token** (Business Settings → System users → Admin system user → assign the app with full control + the WABA → Generate token with `whatsapp_business_messaging` + `whatsapp_business_management`, expiry "Never") and store it as `WHATSAPP_TOKEN`.
- Inbound calls (added later on 2026-10-21): the `connect` webhook's SDP offer is stored on the call and pushed to assigned counsellors as `wa:call:incoming { ...call, sdpOffer }`; the CRM shows Answer/Decline. `POST /calls/:callId/accept { sdpAnswer }` runs Meta's `pre_accept` → `accept`; `POST /calls/:callId/reject` declines. Meta error 138017 on a permission request means permission is already granted (handled as `granted`).

## Voice notes — format (resolved 2026-10-21)
Browsers record WebM/Opus, which Meta rejects (131053). Transcoding to OGG/Opus is accepted and delivered but **does not play in the iPhone app** ("This audio is no longer available") whatever the encoder flags or MIME (`audio/ogg; codecs=opus`) — verified by sending files straight from the Graph API. AAC-LC in a fast-start MP4/M4A (`audio/mp4`, mono, 48 kHz, 48 kbps) plays on iOS/Android/Web. `sendVoice` therefore runs ffmpeg (installed in the Docker image) to produce that, uploads it to Meta's `/media` endpoint and sends by media id (link fallback kept). The CRM's `<audio>` plays the Firebase copy. Inbound voice notes from phones arrive as OGG/Opus and play fine in Chrome.

## Student context in the inbox (added 2026-10-21)
- `attachStudentContext()` runs on every conversation list/get: a conversation with no `student` is matched to a student by phone (last 9 digits of `phoneNo`), the link is saved and the student's counsellors are copied to `assignees` if the conversation had none.
- The conversation DTO's `student` now carries email, reference no, stage, country, what they are looking for (preference level + destinations), intake, IELTS, lead source, parent contact, "in system since", and `relatedApplications` (one row per Application: university, course, level, intake, current phase/outcome, final-choice flag, application id). Applications are fetched in one query per page.
- Also sent with the `clientRef` fix for internal notes (POST /conversations/:id/notes accepts `clientRef`).

## Documents from WhatsApp (added 2026-10-21)
- The conversation's `student.documents[]` lists the student's Documents rows (type key, label, state, received/pending, first file URL, last update). The inbox panel shows them with an "Open" link and a "Still needed" hint for REQUIRED_DOCS.
- `POST /v1/whatsapp/messages/:messageId/save-document { docTypeKey, label?, applicationId? }` files an inbound photo/document as a `Documents` row (`docState: Received`, `blobInfo` pointing at our stored copy, `tag.source: whatsapp`), logs a timeline activity, and stamps `message.savedDocument` so the thread shows "Saved to record". 409 `NOT_LINKED` when the chat has no student; 409 `ALREADY_SAVED` on a repeat.
