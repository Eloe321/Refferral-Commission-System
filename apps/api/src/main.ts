import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { json, urlencoded, type NextFunction, type Request, type Response } from "express";
import { AppModule } from "./app.module.js";
import { parseEnv, type AppEnv } from "./config/env.js";

export { ZodValidationPipe } from "./http/zod-validation.pipe.js";

export async function createApiApp(env: AppEnv): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(env), {
    bodyParser: false,
    logger: env.APP_MODE === "production" ? ["error", "warn"] : ["error", "warn", "log"],
  });
  app.use("/webhooks/unisms", json({ limit: env.UNISMS_WEBHOOK_BODY_LIMIT_BYTES, strict: true }));
  app.use(json({ limit: "100kb", strict: true }));
  app.use(urlencoded({ extended: true, limit: "100kb" }));
  app.use(
    (
      error: { status?: number; type?: string },
      _request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      if (error.status === 413 || error.type === "entity.too.large") {
        response.status(413).json({ status: "payload_too_large" });
        return;
      }
      if (error.status === 400 || error.type === "entity.parse.failed") {
        response.status(400).json({ status: "invalid_request" });
        return;
      }
      next(error);
    },
  );
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  return app;
}

export async function bootstrap(
  envSource: Record<string, string | undefined> = process.env,
): Promise<NestExpressApplication> {
  const env = parseEnv(envSource);
  const app = await createApiApp(env);
  // Only enable process signal listeners for a real bootstrap, never test app factories.
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  return app;
}

const executedPath = process.argv[1];
if (executedPath && fileURLToPath(import.meta.url) === executedPath) {
  void bootstrap();
}
