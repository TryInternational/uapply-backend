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
