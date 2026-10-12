# HookScope

HookScope is a developer tool for receiving and inspecting webhook requests. Create a private endpoint, inspect exact request bytes, verify HMAC signatures locally in the browser, and replay a request to localhost through a CLI tunnel. It is designed for development and demonstrations, not as a production webhook gateway.

## Features and architecture

- 128-bit random endpoint IDs and one-time 256-bit viewing tokens; only SHA-256 token hashes are stored
- Binary-safe raw capture with a 256 KB limit, a 200-request cap, and MongoDB TTL retention
- Authenticated SSE updates with `Last-Event-ID` recovery
- Browser-only HMAC-SHA256 verification, plus an authenticated localhost-only replay tunnel
- Configurable flaky responses and observed retry-interval analysis

```
provider -> /h/:endpointId -> Express -> MongoDB
                              |         ^
dashboard <- authenticated SSE+---------|
dashboard -- replay --> WebSocket tunnel --> CLI --> 127.0.0.1:PORT
```

The stack is Node.js/Express, MongoDB, `ws`, static vanilla JavaScript, and Jest/Supertest. See [docs/design.md](docs/design.md) for the architecture trade-offs.

## Prerequisites

- Node.js 22 or later (an active LTS release)
- MongoDB 7 or later, locally or through MongoDB Atlas

## Installation and configuration

```sh
npm install
cp .env.example .env
```

Set the following values in `.env`:

```dotenv
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB=hookscope
PUBLIC_BASE_URL=http://localhost:3000
ENDPOINT_RETENTION_DAYS=7
REQUEST_RETENTION_DAYS=7
```

For MongoDB Atlas, use its connection string as `MONGODB_URI` and ensure the deployment permits the machine's IP address. Use a distinct `MONGODB_DB` such as `hookscope_test` for any manual testing database. The application creates indexes for endpoint lookup and reverse-chronological request retrieval when it starts. `CORS_ORIGINS` is optional; if the dashboard is hosted elsewhere, provide an explicit comma-separated allow-list. Arbitrary origins are never reflected.

## Run the application

```sh
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), select **Create endpoint**, and copy both values. The viewing token is displayed only at creation and its SHA-256 hash—not the token—is stored in MongoDB.

You can also create an endpoint directly:

```sh
curl -X POST http://localhost:3000/api/endpoints \
  -H 'content-type: application/json' \
  -d '{}'
```

Send a webhook using the returned `captureUrl`:

```sh
curl -X POST 'http://localhost:3000/h/PASTE_ENDPOINT_ID' \
  -H 'content-type: application/json' \
  -d '{"event":"invoice.paid"}'
```

The dashboard uses an authenticated fetch-based SSE stream; the private token is sent only in an `Authorization` request header (never in a URL). To access the request list outside the dashboard, use the same header:

```sh
curl 'http://localhost:3000/api/endpoints/PASTE_ENDPOINT_ID/requests' \
  -H 'Authorization: Bearer PASTE_VIEWING_TOKEN'
```

## Tests

```sh
npm test
```

The test suite uses an isolated in-memory database implementation; it does not connect to or clean up a development MongoDB database. One targeted test deliberately attempts a connection to `127.0.0.1:1` to verify that startup errors are clear; it never performs a write.

Coverage includes raw JSON, empty, binary, Unicode, and oversized capture; private access; HMAC vectors, stale timestamps, malformed and multiple signatures; SSE recovery; concurrent attempt counters; flaky responses; retry analysis; and tunnel validation. Suites that open a listener require an environment that permits loopback sockets.

## Load testing

Start HookScope with a disposable `MONGODB_DB`, create an endpoint, then run:

```sh
HOOKSCOPE_URL=http://127.0.0.1:3000 sh scripts/load-test.sh PASTE_ENDPOINT_ID
```

The script runs autocannon for 15 seconds at 10 and 50 connections, saving raw JSON results locally. Read requests back with the viewing token afterward to confirm persistence. The committed result note explains why no benchmark was run in this sandbox.

### Verified local load-test result (2026-10-13)

The existing script was run unchanged against a disposable local MongoDB database and `http://127.0.0.1:3101`. Its per-endpoint rate limit accepted the first 120 requests; the remaining requests were correctly rate-limited. These measurements therefore describe local response throughput under that limiter, not sustained request persistence throughput.

| Run | Connections | Duration | Requests/s | Median latency | p95 latency | Errors | Non-2xx |
| --- | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| Baseline | 10 | 15 s | 37,797.87 | 0 ms | Not emitted by autocannon's JSON output | 0 | 566,847 |
| High concurrency | 50 | 15.01 s | 37,976.54 | 1 ms | Not emitted by autocannon's JSON output | 0 | 569,615 |

All 120 accepted requests were persisted with contiguous sequences 1–120 and HTTP 202 capture responses. Their stored raw payloads matched the script's 43-byte JSON body. Raw autocannon output is in `load-test-results/baseline.json` and `load-test-results/high-concurrency.json`.

## Deployment

Deploy to a Node host that supports long-lived HTTP responses and WebSockets. Set `PORT`, `MONGODB_URI`, `MONGODB_DB`, `PUBLIC_BASE_URL`, and retention values as environment variables, with an Atlas or equivalent database accessible from the host. Never commit credentials. The service exposes `GET /api/health`, uses database selection timeouts and HTTP request/header/keep-alive limits, and closes tunnels, the HTTP listener, and MongoDB on SIGINT/SIGTERM. Confirm your host's connection-duration limits: low-cost tiers may terminate SSE or WebSocket connections. Deployment has not been performed from this workspace.

## Local replay demonstration

Start HookScope, create an endpoint in the dashboard, then run a local target application on the port you will use for replay:

```sh
node -e "require('http').createServer((req,res) => { let body=''; req.on('data',c=>body+=c); req.on('end',()=>res.end('local received: '+body)); }).listen(3000)"
```

In another terminal, connect the CLI (the token is used only in the WebSocket authorization header and is never printed):

```sh
npm run hookscope -- listen 3000 --endpoint PASTE_ENDPOINT_ID --token PASTE_VIEWING_TOKEN
```

Capture a request with `curl` as above, open it in the dashboard, and select **Replay to localhost**. The inspector shows the local response status, duration, and an 8 KB maximum preview. The CLI always forwards to `127.0.0.1` at the exact selected port—never an arbitrary host.

To observe retries, configure flaky mode through the authenticated API:

```sh
curl -X PATCH 'http://localhost:3000/api/endpoints/PASTE_ENDPOINT_ID/config' \
  -H 'Authorization: Bearer PASTE_VIEWING_TOKEN' -H 'content-type: application/json' \
  -d '{"flaky":{"initialFailures":2,"failureStatus":429,"retryAfterSeconds":3}}'
```

Send the same request with a stable `x-event-id` three times. The first two responses are 429 with `Retry-After`; the third uses the configured success response. The request inspector's retry analysis shows attempt sequence, response status, and observed intervals. Events group by `x-event-id`, then `stripe-event-id`, otherwise by a SHA-256 hash of the raw body. Identical bodies without an event ID can therefore be grouped together even if they are unrelated events.

## Security notes

- Endpoint IDs use 128 bits of cryptographic randomness; viewing tokens use 256 bits.
- Capture bodies are stored as Base64 so they are reversible and binary-safe. They are never logged.
- The capture route reads raw bytes before any JSON parsing and rejects bodies over 256 KB.
- The browser uses `textContent` and `pre` elements only; captured fields never become HTML.
- A Content Security Policy is set with Helmet. The Tailwind browser CDN is the only external script source in this initial dashboard.
- Endpoint creation has a small, per-process IP limit (10/minute), and captures are limited per endpoint (120/minute by default). A shared distributed limiter is intentionally deferred until deployment architecture is chosen.
- Request sequence numbers are assigned atomically per endpoint and power SSE `Last-Event-ID` catch-up. The stream is authorized using `fetch`, not native `EventSource`, so the viewing token never appears in a URL.
- Signature verification runs only in the browser using Web Crypto. Secrets are not transmitted, persisted, or logged. Stripe-style `t=…,v1=…` and generic `sha256=…` HMAC-SHA256 headers are supported.
- Endpoints and captured requests expire after seven days by default, using MongoDB TTL indexes. The service also explicitly keeps only the newest 200 requests per endpoint; TTL cleanup alone is not used for that limit. These retention defaults are documented deviations because no separate HookScope guide was supplied with this workspace.
- Tunnel protocol: the CLI opens `GET /api/tunnels/:endpointId` as a WebSocket with a bearer token in the authorization header. The server sends `ready`, then `replay`; the CLI returns `replay_result`. Frames are capped at 64 KB, malformed frames close the socket, one tunnel is allowed per endpoint, native ping/pong detects dead peers, and pending replays fail after 10 seconds.

## Limitations and comparison

Unlike hosted capture tools such as webhook.site or RequestBin, HookScope combines short-lived private endpoints with browser-local signature verification and a localhost-only replay tunnel. It deliberately does not include team accounts, long-term audit storage, provider-specific retry emulation, a shared distributed rate limiter, or multi-instance event fan-out. Captured headers and bodies are visible to an authorized endpoint viewer, so do not use it for production data that must not be retained. This is a practical engineering review, not a formal security audit.

AI assistance is documented in [docs/ai-usage.md](docs/ai-usage.md).
