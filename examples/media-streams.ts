import websocket from "@fastify/websocket";
import Fastify from "fastify";
import fastifyTwilio, { parseTwilioMediaStreamFrame } from "fastify-twilio";

const app = Fastify({ logger: true });

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
  (socket, request) => {
    request.log.info("Twilio Media Stream connected");

    socket.on("message", (raw) => {
      const frame = parseTwilioMediaStreamFrame(raw);
      if (!frame) return;

      if (frame.event === "media") {
        request.log.info(
          {
            streamSid: frame.streamSid,
            track: frame.media.track,
            chunk: frame.media.chunk,
          },
          "received Twilio media frame",
        );
      }
    });
  },
);

await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
