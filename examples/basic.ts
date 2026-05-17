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
  "/twilio/voice",
  { preHandler: app.twilio.verifyWebhook() },
  async (_request, reply) => {
    const response = new twilio.twiml.VoiceResponse();
    response.say("Hello from Fastify.");
    return reply.twiml(response);
  },
);

await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
