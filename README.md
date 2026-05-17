# fastify-twilio

[![npm version](https://img.shields.io/npm/v/fastify-twilio.svg)](https://www.npmjs.com/package/fastify-twilio)
[![npm downloads](https://img.shields.io/npm/dm/fastify-twilio.svg)](https://www.npmjs.com/package/fastify-twilio)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Fastify plugin for Twilio webhooks and Voice Media Streams.

Published on npm as [`fastify-twilio`](https://www.npmjs.com/package/fastify-twilio).

This package focuses on the framework glue that is easy to get subtly wrong:

- `X-Twilio-Signature` validation for form-encoded webhooks.
- JSON webhook validation with `bodySHA256` and the exact raw body.
- Proxy-aware public URL reconstruction.
- Twilio Media Streams WebSocket handshake validation.
- Typed helpers for Media Streams frames.
- A small `reply.twiml(...)` helper.

It does not include any application routing, persistence, AI, transcription, or
business workflow code.

## Install

```sh
npm install fastify-twilio fastify twilio
```

For form-encoded Twilio callbacks, also register `@fastify/formbody`:

```sh
npm install @fastify/formbody
```

## Basic Webhook

```ts
import formbody from "@fastify/formbody";
import Fastify from "fastify";
import twilio from "twilio";
import fastifyTwilio from "fastify-twilio";

const app = Fastify({ logger: true });

await app.register(formbody);
await app.register(fastifyTwilio, {
  authToken: process.env.TWILIO_AUTH_TOKEN,
  trustProxy: true,
});

app.post(
  "/twilio/sms",
  { preHandler: app.twilio.verifyWebhook() },
  async (request, reply) => {
    const body = request.body as { Body?: string };
    const response = new twilio.twiml.MessagingResponse();
    response.message(`You said: ${body.Body ?? ""}`);
    return reply.twiml(response);
  },
);

await app.listen({ port: 3000 });
```

`trustProxy: true` tells the plugin to use `x-forwarded-host` and
`x-forwarded-proto` when reconstructing the public URL Twilio signed. Use it
when your Fastify server sits behind Fly.io, Railway, Render, Vercel, NGINX,
or another proxy that terminates TLS.

## JSON Webhooks

Twilio signs JSON requests differently: the public URL contains a
`bodySHA256` query parameter, and validation must use the exact raw body.

Enable `captureRawBody` in the Fastify scope that receives Twilio JSON
callbacks:

```ts
await app.register(fastifyTwilio, {
  authToken: process.env.TWILIO_AUTH_TOKEN,
  captureRawBody: true,
  trustProxy: true,
});

app.post(
  "/twilio/events",
  { preHandler: app.twilio.verifyWebhook() },
  async (_request, reply) => {
    return reply.code(204).send();
  },
);
```

If another plugin already captures the raw body as `request.rawBody`, this
plugin will use that automatically. You can also pass a route-level raw body
resolver:

```ts
app.post(
  "/twilio/events",
  {
    preHandler: app.twilio.verifyWebhook({
      bodyType: "json",
      rawBody: (request) => request.twilioRawBody,
    }),
  },
  async (_request, reply) => reply.code(204).send(),
);
```

## Media Streams WebSocket Validation

Register `@fastify/websocket`, then use `verifyWebSocket()` as a
`preValidation` hook. Twilio Media Streams send `X-Twilio-Signature` on the
WebSocket handshake request.

```ts
import websocket from "@fastify/websocket";
import fastifyTwilio, { parseTwilioMediaStreamFrame } from "fastify-twilio";

await app.register(websocket);
await app.register(fastifyTwilio, {
  authToken: process.env.TWILIO_AUTH_TOKEN,
  trustProxy: true,
});

app.get(
  "/twilio/media",
  {
    websocket: true,
    preValidation: app.twilio.verifyWebSocket(),
  },
  (socket) => {
    socket.on("message", (raw) => {
      const frame = parseTwilioMediaStreamFrame(raw);
      if (!frame) return;

      if (frame.event === "media") {
        // frame.media.payload is base64-encoded audio/x-mulaw at 8000 Hz.
      }
    });
  },
);
```

The plugin tries both `wss://` and `https://` URL forms for the handshake and,
by default, also tries Twilio's documented trailing-slash fallback.

## Route-Level Overrides

All validation helpers accept route-level overrides:

```ts
app.post(
  "/tenant/:id/twilio",
  {
    preHandler: app.twilio.verifyWebhook({
      authToken: async (request) => {
        const tenant = await loadTenant((request.params as { id: string }).id);
        return tenant.twilioAuthToken;
      },
      url: (request) => `https://hooks.example.com${request.url}`,
    }),
  },
  async (_request, reply) => reply.code(204).send(),
);
```

## Security Defaults

By default, missing Auth Token configuration is a `500` and invalid signatures
are a `403`. The plugin does not silently accept unsigned traffic.

For local demos only, you can opt in:

```ts
await app.register(fastifyTwilio, {
  allowUnsigned: process.env.NODE_ENV !== "production",
});
```

Do not enable unsigned requests in production.

## API

```ts
await app.register(fastifyTwilio, options);
```

Main options:

- `authToken`: string or async function. Falls back to `process.env.TWILIO_AUTH_TOKEN`.
- `authTokenEnv`: environment variable name used when `authToken` is omitted.
- `trustProxy`: use forwarded host/proto headers for public URL reconstruction.
- `allowUnsigned`: explicitly allow requests when no auth token is configured.
- `captureRawBody`: capture raw request bodies for JSON webhook validation.
- `maxRawBodyBytes`: raw body capture limit. Defaults to 1 MiB.
- `includeReplyHelpers`: add `reply.twiml(...)`. Defaults to true.

Decorators:

- `app.twilio.verifyWebhook(options?)`
- `app.twilio.verifyWebSocket(options?)`
- `app.twilio.validateWebhookRequest(request, options?)`
- `app.twilio.validateWebSocketRequest(request, options?)`
- `app.twilio.buildWebhookUrl(request, options?)`
- `app.twilio.buildWebSocketCandidateUrls(request, options?)`
- `reply.twiml(payload, statusCode?)`

Exports:

- `fastifyTwilio`
- `buildWebhookUrl`
- `buildWebSocketCandidateUrls`
- `validateWebhookRequest`
- `validateWebSocketRequest`
- `parseTwilioMediaStreamFrame`
- `serializeTwilioMediaStreamFrame`
- Media Streams TypeScript frame types

## Development

```sh
npm install
npm run -w fastify-twilio typecheck
npm run -w fastify-twilio test
npm run -w fastify-twilio build
```

## License

MIT
