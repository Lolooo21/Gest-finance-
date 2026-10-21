import { NestFactory } from "@nestjs/core";
import { AllExceptionsFilter } from "./common/all-exceptions.filter.js";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { AppModule } from "./app.module.js";

export async function createApp(opts: { rateLimitMax?: number } = {}): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ trustProxy: process.env.TRUST_PROXY === "1" }), { logger: process.env.NODE_ENV === "test" ? false : ["error", "warn"], abortOnError: false });
  app.useGlobalFilters(new AllExceptionsFilter(app.getHttpAdapter()));
  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } });
  // L'import de PDF (coûteux) a son propre plafond et son propre compteur, par IP.
  const isUpload = (url: string) => url.startsWith("/payslips/parse");
  await app.register(rateLimit, {
    max: (req) => (isUpload(req.url) ? 10 : (opts.rateLimitMax ?? 100)),
    keyGenerator: (req) => (isUpload(req.url) ? `upload:${req.ip}` : req.ip),
    timeWindow: "1 minute",
  });
  return app;
}
