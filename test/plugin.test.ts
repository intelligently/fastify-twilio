import formbody from "@fastify/formbody";
import Fastify from "fastify";
import twilio from "twilio";
import { describe, expect, it } from "vitest";
import fastifyTwilio, {
  buildWebhookUrl,
  parseTwilioMediaStreamFrame,
  serializeTwilioMediaStreamFrame,
} from "../src/index";

const AUTH_TOKEN = "unit-test-auth-token";

describe("fastifyTwilio", () => {
  it("validates a signed form-encoded Twilio webhook behind a proxy", async () => {
    const app = Fastify({ logger: false });
    await app.register(formbody);
    await app.register(fastifyTwilio, {
      authToken: AUTH_TOKEN,
      trustProxy: true,
    });

    app.post(
      "/twilio/sms",
      { preHandler: app.twilio.verifyWebhook() },
      async (_request, reply) => {
        return reply.twiml("<Response><Message>ok</Message></Response>");
      },
    );

    const params = { From: "+15558675310", Body: "Hello" };
    const publicUrl = "https://hooks.example.com/twilio/sms";
    const signature = twilio.getExpectedTwilioSignature(AUTH_TOKEN, publicUrl, params);

    const response = await app.inject({
      method: "POST",
      url: "/twilio/sms",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "hooks.example.com",
        "x-twilio-signature": signature,
      },
      payload: new URLSearchParams(params).toString(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/xml");
    expect(response.body).toContain("<Message>ok</Message>");

    await app.close();
  });

  it("rejects a form webhook with an invalid signature", async () => {
    const app = Fastify({ logger: false });
    await app.register(formbody);
    await app.register(fastifyTwilio, {
      authToken: AUTH_TOKEN,
      trustProxy: true,
    });

    app.post(
      "/twilio/sms",
      { preHandler: app.twilio.verifyWebhook() },
      async () => "should not run",
    );

    const response = await app.inject({
      method: "POST",
      url: "/twilio/sms",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "hooks.example.com",
        "x-twilio-signature": "bad",
      },
      payload: "From=%2B15558675310&Body=Hello",
    });

    expect(response.statusCode).toBe(403);
    expect(response.body).toBe("Invalid Twilio signature");

    await app.close();
  });

  it("fails closed when no auth token is configured", async () => {
    const app = Fastify({ logger: false });
    await app.register(formbody);
    await app.register(fastifyTwilio, {
      authTokenEnv: "FASTIFY_TWILIO_TEST_MISSING_TOKEN",
      trustProxy: true,
    });

    app.post(
      "/twilio/sms",
      { preHandler: app.twilio.verifyWebhook() },
      async () => "should not run",
    );

    const response = await app.inject({
      method: "POST",
      url: "/twilio/sms",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "hooks.example.com",
        "x-twilio-signature": "anything",
      },
      payload: "From=%2B15558675310&Body=Hello",
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain("Auth Token is required");

    await app.close();
  });

  it("validates a JSON webhook with bodySHA256 when raw body capture is enabled", async () => {
    const app = Fastify({ logger: false });
    await app.register(fastifyTwilio, {
      authToken: AUTH_TOKEN,
      captureRawBody: true,
      trustProxy: true,
    });

    app.post(
      "/twilio/events",
      { preHandler: app.twilio.verifyWebhook() },
      async (request) => {
        return { parsed: request.body };
      },
    );

    const rawBody = JSON.stringify({ CallSid: "CA123", CallStatus: "completed" });
    const bodyHash = twilio.getExpectedBodyHash(rawBody);
    const publicUrl = `https://hooks.example.com/twilio/events?bodySHA256=${bodyHash}`;
    const signature = twilio.getExpectedTwilioSignature(AUTH_TOKEN, publicUrl, {});

    const response = await app.inject({
      method: "POST",
      url: `/twilio/events?bodySHA256=${bodyHash}`,
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "hooks.example.com",
        "x-twilio-signature": signature,
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      parsed: { CallSid: "CA123", CallStatus: "completed" },
    });

    await app.close();
  });

  it("fails closed for JSON webhooks when raw body capture is missing", async () => {
    const app = Fastify({ logger: false });
    await app.register(fastifyTwilio, {
      authToken: AUTH_TOKEN,
      trustProxy: true,
    });

    app.post(
      "/twilio/events",
      { preHandler: app.twilio.verifyWebhook() },
      async () => "should not run",
    );

    const rawBody = JSON.stringify({ CallSid: "CA123" });
    const bodyHash = twilio.getExpectedBodyHash(rawBody);
    const publicUrl = `https://hooks.example.com/twilio/events?bodySHA256=${bodyHash}`;
    const signature = twilio.getExpectedTwilioSignature(AUTH_TOKEN, publicUrl, {});

    const response = await app.inject({
      method: "POST",
      url: `/twilio/events?bodySHA256=${bodyHash}`,
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "hooks.example.com",
        "x-twilio-signature": signature,
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(500);
    expect(response.body).toContain("Raw request body is required");

    await app.close();
  });

  it("validates a Media Streams WebSocket signature with WSS candidates", async () => {
    const app = Fastify({ logger: false });
    await app.register(fastifyTwilio, {
      authToken: AUTH_TOKEN,
      trustProxy: true,
    });

    app.get("/media", async (request, reply) => {
      const result = await app.twilio.validateWebSocketRequest(request);
      return reply.code(result.ok ? 200 : result.statusCode).send(result);
    });

    const signature = twilio.getExpectedTwilioSignature(
      AUTH_TOKEN,
      "wss://media.example.com/media",
      {},
    );

    const response = await app.inject({
      method: "GET",
      url: "/media",
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "media.example.com",
        "x-twilio-signature": signature,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      candidateUrls: [
        "wss://media.example.com/media",
        "wss://media.example.com/media/",
        "https://media.example.com/media",
        "https://media.example.com/media/",
      ],
    });

    await app.close();
  });

  it("tries Twilio's trailing-slash WSS fallback for Media Streams", async () => {
    const app = Fastify({ logger: false });
    await app.register(fastifyTwilio, {
      authToken: AUTH_TOKEN,
      trustProxy: true,
    });

    app.get("/media", async (request, reply) => {
      const result = await app.twilio.validateWebSocketRequest(request);
      return reply.code(result.ok ? 200 : result.statusCode).send(result);
    });

    const signature = twilio.getExpectedTwilioSignature(
      AUTH_TOKEN,
      "wss://media.example.com/media/",
      {},
    );

    const response = await app.inject({
      method: "GET",
      url: "/media",
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "media.example.com",
        "x-twilio-signature": signature,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });

    await app.close();
  });

  it("builds public webhook URLs from forwarded headers only when trustProxy is true", async () => {
    const app = Fastify({ logger: false });
    app.get("/url", async (request) => {
      return {
        trusted: await buildWebhookUrl(request, { trustProxy: true }),
        untrusted: await buildWebhookUrl(request, { trustProxy: false }),
      };
    });

    const response = await app.inject({
      method: "GET",
      url: "/url?CallSid=CA123",
      headers: {
        host: "internal.local",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "hooks.example.com",
      },
    });

    expect(response.json()).toEqual({
      trusted: "https://hooks.example.com/url?CallSid=CA123",
      untrusted: "http://internal.local/url?CallSid=CA123",
    });

    await app.close();
  });
});

describe("Media Streams frame helpers", () => {
  it("parses known inbound Twilio Media Streams frames", () => {
    const frame = parseTwilioMediaStreamFrame(
      JSON.stringify({
        event: "media",
        sequenceNumber: "2",
        streamSid: "MZ123",
        media: {
          track: "inbound",
          chunk: "1",
          timestamp: "5",
          payload: "abc123",
        },
      }),
    );

    expect(frame).toMatchObject({
      event: "media",
      streamSid: "MZ123",
      media: { track: "inbound", payload: "abc123" },
    });
  });

  it("returns null for malformed or unsupported frames", () => {
    expect(parseTwilioMediaStreamFrame("not-json")).toBeNull();
    expect(parseTwilioMediaStreamFrame({ event: "unknown" })).toBeNull();
    expect(parseTwilioMediaStreamFrame({ event: "media", streamSid: "MZ123" })).toBeNull();
  });

  it("serializes outbound bidirectional Media Streams frames", () => {
    expect(
      serializeTwilioMediaStreamFrame({
        event: "clear",
        streamSid: "MZ123",
      }),
    ).toBe('{"event":"clear","streamSid":"MZ123"}');
  });
});
