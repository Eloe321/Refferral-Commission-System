import { z } from "zod";

function hasUrlProtocol(value: string, allowedProtocols: readonly string[]): boolean {
  try {
    return allowedProtocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

const httpUrl = z.string().refine(
  (value) => hasUrlProtocol(value, ["http:", "https:"]),
  { message: "Must be an HTTP or HTTPS URL" },
);

const postgresqlUrl = z.string().refine(
  (value) => hasUrlProtocol(value, ["postgres:", "postgresql:"]),
  { message: "Must be a PostgreSQL URL" },
);

const port = z.coerce.number().int().min(1).max(65_535);
const webhookBodyLimit = z.coerce.number().int().min(256).max(65_536).default(16_384);
const nonEmptyString = z.string().trim().min(1);

function isConfiguredUniSmsCredential(value: string | undefined): boolean {
  const trimmedValue = value?.trim();
  return trimmedValue !== undefined && trimmedValue !== "" && trimmedValue !== "replace_me";
}

const appEnvSchema = z
  .object({
    APP_MODE: z.enum(["sandbox", "production"]),
    PORT: port,
    WEB_ORIGIN: httpUrl,
    DATABASE_URL: postgresqlUrl,
    SESSION_SECRET: z.string().min(32),
    OTP_HMAC_SECRET: z.string().min(32),
    SMS_DELIVERY_MODE: z.enum(["preview", "unisms", "disabled"]),
    UNISMS_API_KEY: z.string().trim().optional(),
    UNISMS_SENDER_ID: z.string().trim().optional(),
    UNISMS_WEBHOOK_SECRET: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "replace_me" ? undefined : value,
      nonEmptyString.optional(),
    ),
    UNISMS_WEBHOOK_BODY_LIMIT_BYTES: webhookBodyLimit,
    BOOKING_WEBHOOK_SECRET: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "replace_me" ? undefined : value,
      z.string().min(32).optional(),
    ),
    EMAIL_DELIVERY_MODE: z.enum(["mailpit", "smtp", "disabled"]),
    SMTP_HOST: nonEmptyString.optional(),
    SMTP_PORT: port.optional(),
    SMTP_SECURE: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
    MAILPIT_WEB_URL: httpUrl.optional(),
  })
  .superRefine((env, context) => {
    if (env.SMS_DELIVERY_MODE === "unisms") {
      if (!isConfiguredUniSmsCredential(env.UNISMS_API_KEY)) {
        context.addIssue({
          code: "custom",
          message: "UniSMS credentials must be configured for unisms delivery mode",
          path: ["UNISMS_API_KEY"],
        });
      }

      if (!isConfiguredUniSmsCredential(env.UNISMS_SENDER_ID)) {
        context.addIssue({
          code: "custom",
          message: "UniSMS credentials must be configured for unisms delivery mode",
          path: ["UNISMS_SENDER_ID"],
        });
      }
    }

    if (env.EMAIL_DELIVERY_MODE !== "disabled") {
      if (env.SMTP_HOST === undefined) {
        context.addIssue({
          code: "custom",
          message: "SMTP_HOST is required when email delivery is enabled",
          path: ["SMTP_HOST"],
        });
      }

      if (env.SMTP_PORT === undefined) {
        context.addIssue({
          code: "custom",
          message: "SMTP_PORT is required when email delivery is enabled",
          path: ["SMTP_PORT"],
        });
      }
    }
  });

export type AppEnv = Readonly<z.infer<typeof appEnvSchema>>;

export function parseEnv(env: Record<string, string | undefined>): AppEnv {
  return Object.freeze(appEnvSchema.parse(env));
}
