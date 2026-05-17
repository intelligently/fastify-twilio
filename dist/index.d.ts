import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
export type MaybePromise<T> = T | Promise<T>;
export type TwilioAuthTokenProvider = string | ((request: FastifyRequest) => MaybePromise<string | null | undefined>);
export type TwimlPayload = string | {
    toString(): string;
};
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
export type TwilioValidationResult = {
    ok: true;
    url: string;
    candidateUrls?: string[];
} | {
    ok: false;
    code: "missing-auth-token" | "missing-signature" | "missing-host" | "missing-raw-body" | "invalid-signature";
    message: string;
    statusCode: number;
    url?: string;
    candidateUrls?: string[];
};
export interface FastifyTwilioToolkit {
    verifyWebhook(options?: VerifyWebhookOptions): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    verifyWebSocket(options?: VerifyWebSocketOptions): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    validateWebhookRequest(request: FastifyRequest, options?: VerifyWebhookOptions): Promise<TwilioValidationResult>;
    validateWebSocketRequest(request: FastifyRequest, options?: VerifyWebSocketOptions): Promise<TwilioValidationResult>;
    buildWebhookUrl(request: FastifyRequest, options?: PublicUrlOptions): Promise<string>;
    buildWebSocketCandidateUrls(request: FastifyRequest, options?: VerifyWebSocketOptions): Promise<string[]>;
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
export type TwilioInboundMediaStreamFrame = TwilioConnectedFrame | TwilioStartFrame | TwilioMediaFrame | TwilioDtmfFrame | TwilioMarkFrame | TwilioStopFrame;
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
export type TwilioOutboundMediaStreamFrame = TwilioOutboundMediaFrame | TwilioOutboundMarkFrame | TwilioOutboundClearFrame;
export declare const fastifyTwilio: FastifyPluginAsync<FastifyTwilioOptions>;
export default fastifyTwilio;
export declare function validateWebhookRequest(request: FastifyRequest, options?: VerifyWebhookOptions): Promise<TwilioValidationResult>;
export declare function validateWebSocketRequest(request: FastifyRequest, options?: VerifyWebSocketOptions): Promise<TwilioValidationResult>;
export declare function buildWebhookUrl(request: FastifyRequest, options?: PublicUrlOptions): Promise<string>;
export declare function buildWebSocketCandidateUrls(request: FastifyRequest, options?: VerifyWebSocketOptions): Promise<string[]>;
export declare function parseTwilioMediaStreamFrame(raw: string | Buffer | ArrayBuffer | unknown): TwilioInboundMediaStreamFrame | null;
export declare function serializeTwilioMediaStreamFrame(frame: TwilioOutboundMediaStreamFrame): string;
