import { PassThrough } from "node:stream";
import fp from "fastify-plugin";
import twilio from "twilio";
const DEFAULT_AUTH_TOKEN_ENV = "TWILIO_AUTH_TOKEN";
const DEFAULT_MAX_RAW_BODY_BYTES = 1024 * 1024;
const plugin = async (fastify, options) => {
    const defaults = {
        authToken: options.authToken,
        authTokenEnv: options.authTokenEnv ?? DEFAULT_AUTH_TOKEN_ENV,
        allowUnsigned: options.allowUnsigned ?? false,
        trustProxy: options.trustProxy ?? false,
        host: options.host,
        protocol: options.protocol,
        url: options.url,
    };
    if (options.captureRawBody) {
        if (!fastify.hasRequestDecorator("twilioRawBody")) {
            fastify.decorateRequest("twilioRawBody", null);
        }
        fastify.addHook("preParsing", async (request, _reply, payload) => {
            if (!shouldCaptureRawBody(request))
                return payload;
            const rawBody = await readRawBody(payload, options.maxRawBodyBytes ?? DEFAULT_MAX_RAW_BODY_BYTES);
            request.twilioRawBody = rawBody.toString("utf8");
            const replay = new PassThrough();
            replay.end(rawBody);
            return replay;
        });
    }
    const toolkit = {
        verifyWebhook(routeOptions = {}) {
            return async (request, reply) => {
                const result = await validateWebhookRequest(request, mergeOptions(defaults, routeOptions));
                if (!result.ok) {
                    request.log.warn({ code: result.code, url: result.url, candidateUrls: result.candidateUrls }, "Twilio webhook validation failed");
                    reply.code(result.statusCode).send(result.message);
                }
            };
        },
        verifyWebSocket(routeOptions = {}) {
            return async (request, reply) => {
                const result = await validateWebSocketRequest(request, mergeOptions(defaults, routeOptions));
                if (!result.ok) {
                    request.log.warn({ code: result.code, candidateUrls: result.candidateUrls }, "Twilio WebSocket validation failed");
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
            fastify.decorateReply("twiml", function twiml(payload, statusCode = 200) {
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
export async function validateWebhookRequest(request, options = {}) {
    const authToken = await resolveAuthToken(request, options);
    if (!authToken)
        return missingAuthTokenResult(options);
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
    const valid = bodyType === "json"
        ? validateJsonWebhook(authToken, signature, url, rawBody)
        : twilio.validateRequest(authToken, signature, url, resolveParams(request, options.params));
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
export async function validateWebSocketRequest(request, options = {}) {
    const authToken = await resolveAuthToken(request, options);
    if (!authToken)
        return missingAuthTokenResult(options);
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
    return { ok: true, url: candidateUrls[0], candidateUrls };
}
export async function buildWebhookUrl(request, options = {}) {
    if (typeof options.url === "string")
        return options.url;
    if (typeof options.url === "function")
        return options.url(request);
    const host = options.host ?? publicHost(request, options.trustProxy ?? false);
    if (!host)
        throw new Error("Unable to determine public host for Twilio webhook");
    const protocol = options.protocol ??
        publicProtocol(request, options.trustProxy ?? false, "https");
    return `${protocol}://${host}${request.url}`;
}
export async function buildWebSocketCandidateUrls(request, options = {}) {
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
async function tryBuildWebhookUrl(request, options) {
    try {
        return await buildWebhookUrl(request, options);
    }
    catch {
        return null;
    }
}
async function tryBuildWebSocketCandidateUrls(request, options) {
    try {
        return await buildWebSocketCandidateUrls(request, options);
    }
    catch {
        return [];
    }
}
export function parseTwilioMediaStreamFrame(raw) {
    let value;
    try {
        value =
            typeof raw === "string"
                ? JSON.parse(raw)
                : Buffer.isBuffer(raw)
                    ? JSON.parse(raw.toString("utf8"))
                    : raw instanceof ArrayBuffer
                        ? JSON.parse(Buffer.from(raw).toString("utf8"))
                        : raw;
    }
    catch {
        return null;
    }
    if (!isRecord(value) || typeof value.event !== "string")
        return null;
    switch (value.event) {
        case "connected":
            return typeof value.protocol === "string" && typeof value.version === "string"
                ? value
                : null;
        case "start":
            return isRecord(value.start) &&
                typeof value.start.streamSid === "string" &&
                typeof value.start.accountSid === "string" &&
                typeof value.start.callSid === "string" &&
                isRecord(value.start.mediaFormat)
                ? value
                : null;
        case "media":
            return typeof value.streamSid === "string" &&
                isRecord(value.media) &&
                (value.media.track === "inbound" || value.media.track === "outbound") &&
                typeof value.media.payload === "string"
                ? value
                : null;
        case "dtmf":
            return typeof value.streamSid === "string" &&
                isRecord(value.dtmf) &&
                typeof value.dtmf.digit === "string"
                ? value
                : null;
        case "mark":
            return typeof value.streamSid === "string" &&
                isRecord(value.mark) &&
                typeof value.mark.name === "string"
                ? value
                : null;
        case "stop":
            return typeof value.streamSid === "string" ? value : null;
        default:
            return null;
    }
}
export function serializeTwilioMediaStreamFrame(frame) {
    return JSON.stringify(frame);
}
function validateJsonWebhook(authToken, signature, url, rawBody) {
    if (rawBody == null)
        return false;
    const body = Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody;
    return twilio.validateRequestWithBody(authToken, signature, url, body);
}
function resolveParams(request, params) {
    if (typeof params === "function")
        return params(request);
    if (params)
        return params;
    const body = request.body;
    if (!body)
        return {};
    if (body instanceof URLSearchParams)
        return Object.fromEntries(body.entries());
    if (isRecord(body))
        return body;
    return {};
}
function resolveRawBody(request, rawBody) {
    if (typeof rawBody === "function")
        return rawBody(request);
    if (rawBody != null)
        return rawBody;
    const maybeRawBody = request.rawBody;
    if (typeof maybeRawBody === "string" || Buffer.isBuffer(maybeRawBody))
        return maybeRawBody;
    return request.twilioRawBody;
}
function inferBodyType(request, url, bodyType) {
    if (bodyType !== "auto")
        return bodyType;
    if (new URL(url).searchParams.has("bodySHA256"))
        return "json";
    const contentType = getHeader(request, "content-type")?.toLowerCase() ?? "";
    return contentType.includes("application/json") ? "json" : "form";
}
async function resolveAuthToken(request, options) {
    if (typeof options.authToken === "function") {
        return (await options.authToken(request)) ?? null;
    }
    if (typeof options.authToken === "string")
        return options.authToken;
    return process.env[options.authTokenEnv ?? DEFAULT_AUTH_TOKEN_ENV] ?? null;
}
function missingAuthTokenResult(options) {
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
function publicHost(request, trustProxy) {
    if (trustProxy) {
        const forwardedHost = getHeader(request, "x-forwarded-host");
        if (forwardedHost)
            return firstForwardedValue(forwardedHost);
    }
    const host = getHeader(request, "host");
    return host ? firstForwardedValue(host) : null;
}
function publicProtocol(request, trustProxy, fallback) {
    if (trustProxy) {
        const forwardedProto = getHeader(request, "x-forwarded-proto");
        if (forwardedProto) {
            const proto = firstForwardedValue(forwardedProto).replace(/:$/, "").toLowerCase();
            if (proto === "http" || proto === "https")
                return proto;
        }
    }
    const protocol = request.protocol.replace(/:$/, "").toLowerCase();
    return protocol === "http" || protocol === "https" ? protocol : fallback;
}
function getHeader(request, name) {
    const value = request.headers[name.toLowerCase()];
    if (Array.isArray(value))
        return value[0] ?? null;
    return value ?? null;
}
function firstForwardedValue(value) {
    return value.split(",")[0]?.trim() ?? value;
}
function withProtocol(url, protocol) {
    const cloned = new URL(url);
    cloned.protocol = `${protocol}:`;
    return cloned.toString();
}
function appendTrailingSlash(url) {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/"))
        return url;
    parsed.pathname = `${parsed.pathname}/`;
    return parsed.toString();
}
function uniqueStrings(values) {
    return [...new Set(values)];
}
function mergeOptions(defaults, overrides) {
    return { ...defaults, ...overrides };
}
function shouldCaptureRawBody(request) {
    if (!["POST", "PUT", "PATCH"].includes(request.method.toUpperCase()))
        return false;
    const contentType = getHeader(request, "content-type")?.toLowerCase() ?? "";
    return (contentType.includes("application/json") ||
        contentType.includes("application/x-www-form-urlencoded") ||
        contentType.includes("text/plain"));
}
async function readRawBody(stream, maxBytes) {
    const chunks = [];
    let total = 0;
    for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buffer.length;
        if (total > maxBytes) {
            const error = new Error("Twilio raw body exceeded maxRawBodyBytes");
            error.statusCode = 413;
            throw error;
        }
        chunks.push(buffer);
    }
    return Buffer.concat(chunks);
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=index.js.map