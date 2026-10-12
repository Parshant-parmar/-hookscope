# HookScope design

## Capture and verification

Webhook providers sign the exact bytes they transmit. Parsing then serializing JSON can change whitespace, key order, Unicode encoding, or binary data, which makes a correct signature appear invalid. HookScope therefore captures the request with Express's raw-body parser, stores Base64 for binary-safe persistence, and exposes those original bytes to the dashboard.

Signing secrets are entered into the dashboard and processed with the browser's Web Crypto API. They are neither included in HookScope API requests nor persisted or logged by the server. This narrows the service's secret-handling responsibility while still allowing Stripe-style and generic HMAC-SHA256 verification.

## Live delivery recovery

Each endpoint has an atomically incremented `nextSequence`. SSE events use that sequence as their event id. A reconnect supplies `Last-Event-ID`; the server subscribes first, then queries persisted requests with a greater sequence in ascending order. The subscriber ignores events at or below the last delivered sequence, preventing catch-up/live overlap from becoming a duplicate.

## Retries and replay

Delivery attempts are counted with a MongoDB `findOneAndUpdate` using `$inc` and a unique `(endpointId, eventKey)` index. That makes concurrent attempt numbers atomic. Retry analysis only shows timestamps and intervals that were captured; it does not guess a provider's retry policy.

The server never sends captured content to a destination URL. Instead, the CLI opens an authenticated WebSocket tunnel and forwards a requested replay only to `127.0.0.1` and the port chosen on its command line. The server bounds frames to 64 KB, replay waits to 10 seconds, and removes dead tunnels via ping/pong. The CLI reconnects with capped exponential backoff.

## Scaling limitations

The rate limit and live event hub are in-process. Multiple server instances require a shared limiter and a shared event fan-out system (for example Redis), while MongoDB remains the durable SSE catch-up source. The dashboard is intentionally small and uses a Tailwind CDN; production deployments may prefer a compiled, pinned frontend asset. MongoDB TTL cleanup is asynchronous, so expired data can remain briefly until the database's TTL monitor runs.
