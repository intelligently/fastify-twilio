import { PassThrough } from "node:stream";
import type { Readable } from "node:stream";
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import fp from "fastify-plugin";
import twilio from "twilio";

export type MaybePromise<T> = T | Promise<T>;
export type TwilioAuthTokenProvider =
  | string
  | ((request: FastifyRequest) => MaybePromise<string | null | undefined>);

export type TwimlPayload = string | { toString(): string };

export type TwilioBodyType = "auto" | "form" | "json";

export type PublicUrlResolver = (request: FastifyRequest) => MaybePromise<string>;

export interface PublicUrlOptions {
  /**
   * Exact externally visible URL Twilio called. Overrides host/protocol
   * inference when provided.
   */
  url?: string | PublicUrlResolver;
  /**
   * Externally visible host. Useful when the app is behind a proxy that does
   * not forward host headers.
   */
  host?: string;
  /**
   * Externally visible protocol.
   */
  protocol?: "http" | "https";
  /**
   * Trust x-forwarded-host and x-forwarded-proto when reconstructing the URL.
   */
  trustProxy?: boolean;
}

export interface FastifyTwilioOptions extends PublicUrlOptions {
  /**
   * Twilio Auth Token or a function that resolves one per request. If omitted,
   * the plugin reads process.env[authTokenEnv].
   */
  authToken?: TwilioAuthTokenProvider;
  /**
   * Environment variable used when authToken is omitted.
   *
   * @default "TWILIO_AUTH_TOKEN"
   */
  authTokenEnv?: string;
  /**
   * Explicitly allow unsigned requests when no auth token is configured.
   * Defaults to false so production integrations fail closed.
   */
  allowUnsigned?: boolean;
  /**
   * Capture raw request bodies so JSON webhooks can be verified with
   * validateRequestWithBody. Register this plugin only in the route scope where
   * you need capture if you do not want it applied globally.
   */
  captureRawBody?: boolean;
  /**
   * Maximum raw body size captured by this plugin.
   *
   * @default 1048576
   */
  maxRawBodyBytes?: number;
  /**
   * Add reply.twiml(...).
   *
   * @default true
   */
  includeReplyHelpers?: boolean;
}

export interface VerifyWebhookOptions extends PublicUrlOptions {
  authToken?: TwilioAuthTokenProvider;
  authTokenEnv?: string;
  allowUnsigned?: boolean;
  bodyType?: TwilioBodyType;
  params?: Record<string, unknown> | ((request: FastifyRequest) => Record<string, unknown>);
  rawBody?: string | Buffer | ((request: FastifyRequest) => string | Buffer | null | undefined);
}

export interface VerifyWebSocketOptions extends PublicUrlOptions {
  authToken?: TwilioAuthTokenProvider;
  authTokenEnv?: string;
  allowUnsigned?: boolean;
  /**
   * Twilio recommends trying a trailing slash when WSS handshake validation
   * fails for Media Streams.
   *
   * @default true
   */
  includeTrailingSlashCandidate?: boolean;
}

export type TwilioValidationResult =
  | {
      ok: true;
      url: string;
      candidateUrls?: string[];
    }
  | {
      ok: false;
      code:
        | "missing-auth-token"
        | "missing-signature"
        | "missing-host"
        | "missing-raw-body"
        | "invalid-signature";
      message: string;
      statusCode: number;
      url?: string;
      candidateUrls?: string[];
    };

export interface FastifyTwilioToolkit {
  verifyWebhook(options?: VerifyWebhookOptions): (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<void>;
  verifyWebSocket(options?: VerifyWebSocketOptions): (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<void>;
  validateWebhookRequest(
    request: FastifyRequest,
    options?: VerifyWebhookOptions,
  ): Promise<TwilioValidationResult>;
  validateWebSocketRequest(
    request: FastifyRequest,
    options?: VerifyWebSocketOptions,
  ): Promise<TwilioValidationResult>;
  buildWebhookUrl(request: FastifyRequest, options?: PublicUrlOptions): Promise<string>;
  buildWebSocketCandidateUrls(
    request: FastifyRequest,
    options?: VerifyWebSocketOptions,
  ): Promise<string[]>;
}

declare module "fastify" {
  interface FastifyInstance {
    twilio: FastifyTwilioToolkit;
  }

  interface FastifyReply {
    twiml(payload: TwimlPayload, statusCode?: number): FastifyReply;
  }

  interface FastifyRequest {
    twilioRawBody?: string | null;
  }
}

export type TwilioConnectedFrame = {
  event: "connected";
  protocol: string;
  version: string;
};

export type TwilioStartFrame = {
  event: "start";
  sequenceNumber?: string;
  streamSid?: string;
  start: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks?: Array<"inbound" | "outbound">;
    customParameters?: Record<string, string>;
    mediaFormat: {
      encoding: "audio/x-mulaw" | string;
      sampleRate: 8000 | number;
      channels: 1 | number;
    };
  };
};

export type TwilioMediaFrame = {
  event: "media";
  sequenceNumber?: string;
  streamSid: string;
  media: {
    track: "inbound" | "outbound";
    chunk: string;
    timestamp: string;
    payload: string;
  };
};

export type TwilioDtmfFrame = {
  event: "dtmf";
  sequenceNumber?: string;
  streamSid: string;
  dtmf: {
    track: "inbound_track";
    digit: string;
  };
};

export type TwilioMarkFrame = {
  event: "mark";
  sequenceNumber?: string;
  streamSid: string;
  mark: {
    name: string;
  };
};

export type TwilioStopFrame = {
  event: "stop";
  sequenceNumber?: string;
  streamSid: string;
  stop?: {
    accountSid?: string;
    callSid?: string;
  };
};

export type TwilioInboundMediaStreamFrame =
  | TwilioConnectedFrame
  | TwilioStartFrame
  | TwilioMediaFrame
  | TwilioDtmfFrame
  | TwilioMarkFrame
  | TwilioStopFrame;

export type TwilioOutboundMediaFrame = {
  event: "media";
  streamSid: string;
  media: {
    payload: string;
  };
};

export type TwilioOutboundMarkFrame = {
  event: "mark";
  streamSid: string;
  mark: {
    name: string;
  };
};

export type TwilioOutboundClearFrame = {
  event: "clear";
  streamSid: string;
};

export type TwilioOutboundMediaStreamFrame =
  | TwilioOutboundMediaFrame
  | TwilioOutboundMarkFrame
  | TwilioOutboundClearFrame;

const DEFAULT_AUTH_TOKEN_ENV = "TWILIO_AUTH_TOKEN";
const DEFAULT_MAX_RAW_BODY_BYTES = 1024 * 1024;

const plugin: FastifyPluginAsync<FastifyTwilioOptions> = async (fastify, options) => {
  const defaults = {
    authToken: options.authToken,
    authTokenEnv: options.authTokenEnv ?? DEFAULT_AUTH_TOKEN_ENV,
    allowUnsigned: options.allowUnsigned ?? false,
    trustProxy: options.trustProxy ?? false,
    host: options.host,
    protocol: options.protocol,
    url: options.url,
  } satisfies FastifyTwilioOptions;

  if (options.captureRawBody) {
    if (!fastify.hasRequestDecorator("twilioRawBody")) {
      fastify.decorateRequest("twilioRawBody", null);
    }
    fastify.addHook("preParsing", async (request, _reply, payload) => {
      if (!shouldCaptureRawBody(request)) return payload;

      const rawBody = await readRawBody(
        payload as Readable,
        options.maxRawBodyBytes ?? DEFAULT_MAX_RAW_BODY_BYTES,
      );
      request.twilioRawBody = rawBody.toString("utf8");

      const replay = new PassThrough();
      replay.end(rawBody);
      return replay;
    });
  }

  const toolkit: FastifyTwilioToolkit = {
    verifyWebhook(routeOptions = {}) {
      return async (request, reply) => {
        const result = await validateWebhookRequest(request, mergeOptions(defaults, routeOptions));
        if (!result.ok) {
          request.log.warn(
            { code: result.code, url: result.url, candidateUrls: result.candidateUrls },
            "Twilio webhook validation failed",
          );
          reply.code(result.statusCode).send(result.message);
        }
      };
    },
    verifyWebSocket(routeOptions = {}) {
      return async (request, reply) => {
        const result = await validateWebSocketRequest(
          request,
          mergeOptions(defaults, routeOptions),
        );
        if (!result.ok) {
          request.log.warn(
            { code: result.code, candidateUrls: result.candidateUrls },
            "Twilio WebSocket validation failed",
          );
          reply.code(result.statusCode).send(result.message);
        }
      };
    },
    validateWebhookRequest(request, routeOptions = {}) {
      return validateWebhookRequest(request, mergeOptions(defaults, routeOptions));
    },
    validateWebSocketRequest(request, routeOptions = {}) {
      return validateWebSocketRequest(request, mergeOptions(defaults, routeOptions));
    },
    buildWebhookUrl(request, routeOptions = {}) {
      return buildWebhookUrl(request, mergeOptions(defaults, routeOptions));
    },
    buildWebSocketCandidateUrls(request, routeOptions = {}) {
      return buildWebSocketCandidateUrls(request, mergeOptions(defaults, routeOptions));
    },
  };

  if (!fastify.hasDecorator("twilio")) {
    fastify.decorate("twilio", toolkit);
  }

  if (options.includeReplyHelpers ?? true) {
    if (!fastify.hasReplyDecorator("twiml")) {
      fastify.decorateReply("twiml", function twiml(payload: TwimlPayload, statusCode = 200) {
        return this.code(statusCode).type("text/xml").send(payload.toString());
      });
    }
  }
};

export const fastifyTwilio = fp(plugin, {
  fastify: "5.x",
  name: "fastify-twilio",
});

export default fastifyTwilio;

export async function validateWebhookRequest(
  request: FastifyRequest,
  options: VerifyWebhookOptions = {},
): Promise<TwilioValidationResult> {
  const authToken = await resolveAuthToken(request, options);
  if (!authToken) return missingAuthTokenResult(options);

  const signature = getHeader(request, "x-twilio-signature");
  if (!signature) {
    return {
      ok: false,
      code: "missing-signature",
      message: "Missing X-Twilio-Signature",
      statusCode: 403,
    };
  }

  const url = await tryBuildWebhookUrl(request, options);
  if (!url) {
    return {
      ok: false,
      code: "missing-host",
      message: "Unable to determine public Twilio webhook URL",
      statusCode: 500,
    };
  }

  const bodyType = inferBodyType(request, url, options.bodyType ?? "auto");
  const rawBody = bodyType === "json" ? resolveRawBody(request, options.rawBody) : undefined;
  if (bodyType === "json" && rawBody == null) {
    return {
      ok: false,
      code: "missing-raw-body",
      message: "Raw request body is required for Twilio JSON webhook validation",
      statusCode: 500,
      url,
    };
  }

  const valid =
    bodyType === "json"
      ? validateJsonWebhook(authToken, signature, url, rawBody)
      : twilio.validateRequest(
          authToken,
          signature,
          url,
          resolveParams(request, options.params),
        );

  if (!valid) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "Invalid Twilio signature",
      statusCode: 403,
      url,
    };
  }

  return { ok: true, url };
}

export async function validateWebSocketRequest(
  request: FastifyRequest,
  options: VerifyWebSocketOptions = {},
): Promise<TwilioValidationResult> {
  const authToken = await resolveAuthToken(request, options);
  if (!authToken) return missingAuthTokenResult(options);

  const signature = getHeader(request, "x-twilio-signature");
  if (!signature) {
    return {
      ok: false,
      code: "missing-signature",
      message: "Missing X-Twilio-Signature",
      statusCode: 403,
    };
  }

  const candidateUrls = await tryBuildWebSocketCandidateUrls(request, options);
  if (candidateUrls.length === 0) {
    return {
      ok: false,
      code: "missing-host",
      message: "Unable to determine public WebSocket URL",
      statusCode: 500,
    };
  }

  const valid = candidateUrls.some((url) => twilio.validateRequest(authToken, signature, url, {}));
  if (!valid) {
    return {
      ok: false,
      code: "invalid-signature",
      message: "Invalid Twilio signature",
      statusCode: 403,
      candidateUrls,
    };
  }

  return { ok: true, url: candidateUrls[0]!, candidateUrls };
}

export async function buildWebhookUrl(
  request: FastifyRequest,
  options: PublicUrlOptions = {},
): Promise<string> {
  if (typeof options.url === "string") return options.url;
  if (typeof options.url === "function") return options.url(request);

  const host = options.host ?? publicHost(request, options.trustProxy ?? false);
  if (!host) throw new Error("Unable to determine public host for Twilio webhook");

  const protocol =
    options.protocol ??
    publicProtocol(request, options.trustProxy ?? false, "https");

  return `${protocol}://${host}${request.url}`;
}

export async function buildWebSocketCandidateUrls(
  request: FastifyRequest,
  options: VerifyWebSocketOptions = {},
): Promise<string[]> {
  const exactUrl = typeof options.url === "string" ? options.url : undefined;
  const baseUrl = exactUrl ?? (await buildWebhookUrl(request, options));
  const parsed = new URL(baseUrl);
  const httpProtocol = parsed.protocol.replace(/:$/, "") === "http" ? "http" : "https";
  const wsProtocol = httpProtocol === "https" ? "wss" : "ws";
  const candidates = uniqueStrings([
    withProtocol(parsed, wsProtocol),
    withProtocol(parsed, httpProtocol),
  ]);

  if (options.includeTrailingSlashCandidate ?? true) {
    return uniqueStrings(candidates.flatMap((url) => [url, appendTrailingSlash(url)]));
  }

  return candidates;
}

async function tryBuildWebhookUrl(
  request: FastifyRequest,
  options: PublicUrlOptions,
): Promise<string | null> {
  try {
    return await buildWebhookUrl(request, options);
  } catch {
    return null;
  }
}

async function tryBuildWebSocketCandidateUrls(
  request: FastifyRequest,
  options: VerifyWebSocketOptions,
): Promise<string[]> {
  try {
    return await buildWebSocketCandidateUrls(request, options);
  } catch {
    return [];
  }
}

export function parseTwilioMediaStreamFrame(
  raw: string | Buffer | ArrayBuffer | unknown,
): TwilioInboundMediaStreamFrame | null {
  let value: unknown;
  try {
    value =
      typeof raw === "string"
        ? JSON.parse(raw)
        : Buffer.isBuffer(raw)
          ? JSON.parse(raw.toString("utf8"))
          : raw instanceof ArrayBuffer
            ? JSON.parse(Buffer.from(raw).toString("utf8"))
            : raw;
  } catch {
    return null;
  }

  if (!isRecord(value) || typeof value.event !== "string") return null;
  switch (value.event) {
    case "connected":
      return typeof value.protocol === "string" && typeof value.version === "string"
        ? (value as TwilioConnectedFrame)
        : null;
    case "start":
      return isRecord(value.start) &&
        typeof value.start.streamSid === "string" &&
        typeof value.start.accountSid === "string" &&
        typeof value.start.callSid === "string" &&
        isRecord(value.start.mediaFormat)
        ? (value as TwilioStartFrame)
        : null;
    case "media":
      return typeof value.streamSid === "string" &&
        isRecord(value.media) &&
        (value.media.track === "inbound" || value.media.track === "outbound") &&
        typeof value.media.payload === "string"
        ? (value as TwilioMediaFrame)
        : null;
    case "dtmf":
      return typeof value.streamSid === "string" &&
        isRecord(value.dtmf) &&
        typeof value.dtmf.digit === "string"
        ? (value as TwilioDtmfFrame)
        : null;
    case "mark":
      return typeof value.streamSid === "string" &&
        isRecord(value.mark) &&
        typeof value.mark.name === "string"
        ? (value as TwilioMarkFrame)
        : null;
    case "stop":
      return typeof value.streamSid === "string" ? (value as TwilioStopFrame) : null;
    default:
      return null;
  }
}

export function serializeTwilioMediaStreamFrame(frame: TwilioOutboundMediaStreamFrame): string {
  return JSON.stringify(frame);
}

function validateJsonWebhook(
  authToken: string,
  signature: string,
  url: string,
  rawBody: string | Buffer | null | undefined,
): boolean {
  if (rawBody == null) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
  return twilio.validateRequestWithBody(authToken, signature, url, body);
}

function resolveParams(
  request: FastifyRequest,
  params?: Record<string, unknown> | ((request: FastifyRequest) => Record<string, unknown>),
): Record<string, unknown> {
  if (typeof params === "function") return params(request);
  if (params) return params;
  const body = request.body;
  if (!body) return {};
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  if (isRecord(body)) return body;
  return {};
}

function resolveRawBody(
  request: FastifyRequest,
  rawBody?: string | Buffer | ((request: FastifyRequest) => string | Buffer | null | undefined),
): string | Buffer | null | undefined {
  if (typeof rawBody === "function") return rawBody(request);
  if (rawBody != null) return rawBody;

  const maybeRawBody = (request as FastifyRequest & { rawBody?: unknown }).rawBody;
  if (typeof maybeRawBody === "string" || Buffer.isBuffer(maybeRawBody)) return maybeRawBody;
  return request.twilioRawBody;
}

function inferBodyType(
  request: FastifyRequest,
  url: string,
  bodyType: TwilioBodyType,
): Exclude<TwilioBodyType, "auto"> {
  if (bodyType !== "auto") return bodyType;
  if (new URL(url).searchParams.has("bodySHA256")) return "json";
  const contentType = getHeader(request, "content-type")?.toLowerCase() ?? "";
  return contentType.includes("application/json") ? "json" : "form";
}

async function resolveAuthToken(
  request: FastifyRequest,
  options: { authToken?: TwilioAuthTokenProvider; authTokenEnv?: string; allowUnsigned?: boolean },
): Promise<string | null> {
  if (typeof options.authToken === "function") {
    return (await options.authToken(request)) ?? null;
  }
  if (typeof options.authToken === "string") return options.authToken;
  return process.env[options.authTokenEnv ?? DEFAULT_AUTH_TOKEN_ENV] ?? null;
}

function missingAuthTokenResult(options: { allowUnsigned?: boolean }): TwilioValidationResult {
  if (options.allowUnsigned) {
    return { ok: true, url: "" };
  }
  return {
    ok: false,
    code: "missing-auth-token",
    message: "Twilio Auth Token is required for request validation",
    statusCode: 500,
  };
}

function publicHost(request: FastifyRequest, trustProxy: boolean): string | null {
  if (trustProxy) {
    const forwardedHost = getHeader(request, "x-forwarded-host");
    if (forwardedHost) return firstForwardedValue(forwardedHost);
  }
  const host = getHeader(request, "host");
  return host ? firstForwardedValue(host) : null;
}

function publicProtocol(
  request: FastifyRequest,
  trustProxy: boolean,
  fallback: "http" | "https",
): "http" | "https" {
  if (trustProxy) {
    const forwardedProto = getHeader(request, "x-forwarded-proto");
    if (forwardedProto) {
      const proto = firstForwardedValue(forwardedProto).replace(/:$/, "").toLowerCase();
      if (proto === "http" || proto === "https") return proto;
    }
  }

  const protocol = request.protocol.replace(/:$/, "").toLowerCase();
  return protocol === "http" || protocol === "https" ? protocol : fallback;
}

function getHeader(request: FastifyRequest, name: string): string | null {
  const value = request.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function firstForwardedValue(value: string): string {
  return value.split(",")[0]?.trim() ?? value;
}

function withProtocol(url: URL, protocol: string): string {
  const cloned = new URL(url);
  cloned.protocol = `${protocol}:`;
  return cloned.toString();
}

function appendTrailingSlash(url: string): string {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith("/")) return url;
  parsed.pathname = `${parsed.pathname}/`;
  return parsed.toString();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function mergeOptions<T extends object, U extends object>(defaults: T, overrides: U): T & U {
  return { ...defaults, ...overrides };
}

function shouldCaptureRawBody(request: FastifyRequest): boolean {
  if (!["POST", "PUT", "PATCH"].includes(request.method.toUpperCase())) return false;
  const contentType = getHeader(request, "content-type")?.toLowerCase() ?? "";
  return (
    contentType.includes("application/json") ||
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("text/plain")
  );
}

async function readRawBody(stream: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      const error = new Error("Twilio raw body exceeded maxRawBodyBytes") as Error & {
        statusCode?: number;
      };
      error.statusCode = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
