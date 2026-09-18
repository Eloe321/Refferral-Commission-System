import { z } from "zod";
import { describe, expect, it } from "vitest";

import { parseEnv } from "../../src/config/env.js";

const base = {
  APP_MODE: "sandbox",
  PORT: "4000",
  WEB_ORIGIN: "http://localhost:3000",
  DATABASE_URL: "postgres://sandbox:sandbox@localhost:5432/referral_sandbox",
  SESSION_SECRET: "development-session-secret-at-least-32-characters",
  OTP_HMAC_SECRET: "development-otp-secret-at-least-32-characters",
  SMS_DELIVERY_MODE: "preview",
  EMAIL_DELIVERY_MODE: "mailpit",
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
  SMTP_SECURE: "false",
};

const liveUniSms = {
  UNISMS_API_KEY: "live-api-key",
  UNISMS_SENDER_ID: "ReferralSandbox",
};

async function inspectValue(value: object): Promise<string> {
  const moduleName = ["node", "util"].join(":");
  const nodeUtil = (await import(moduleName)) as { inspect(input: object): string };
  return nodeUtil.inspect(value);
}

function parseUniSms(overrides: Partial<typeof liveUniSms>) {
  return parseEnv({
    ...base,
    SMS_DELIVERY_MODE: "unisms",
    ...liveUniSms,
    ...overrides,
  });
}

function expectZodError(parse: () => unknown): z.ZodError {
  try {
    parse();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected environment validation to throw a ZodError");
}

describe("parseEnv", () => {
  it("parses the safe preview SMS configuration", () => {
    expect(parseEnv(base).SMS_DELIVERY_MODE).toBe("preview");
    expect(parseEnv(base).UNISMS_WEBHOOK_BODY_LIMIT_BYTES).toBe(16_384);
  });

  it("treats the example webhook secret as unconfigured", () => {
    expect(
      parseEnv({ ...base, UNISMS_WEBHOOK_SECRET: " replace_me " }).UNISMS_WEBHOOK_SECRET,
    ).toBeUndefined();
  });

  it.each(["0", "255", "65537", "not-a-number"])(
    "rejects an invalid webhook body limit of %j",
    (value) => {
      expect(() =>
        parseEnv({ ...base, UNISMS_WEBHOOK_BODY_LIMIT_BYTES: value }),
      ).toThrow();
    },
  );

  it.each([
    ["a missing API key", "UNISMS_API_KEY", undefined],
    ["an empty API key", "UNISMS_API_KEY", ""],
    ["a whitespace-only API key", "UNISMS_API_KEY", "   "],
    ["an example API key", "UNISMS_API_KEY", "replace_me"],
    ["a padded example API key", "UNISMS_API_KEY", " replace_me "],
    ["a missing sender ID", "UNISMS_SENDER_ID", undefined],
    ["an empty sender ID", "UNISMS_SENDER_ID", ""],
    ["a whitespace-only sender ID", "UNISMS_SENDER_ID", "   "],
    ["an example sender ID", "UNISMS_SENDER_ID", "replace_me"],
    ["a padded example sender ID", "UNISMS_SENDER_ID", " replace_me "],
  ])("rejects unisms mode with %s", (_label, field, value) => {
    const error = expectZodError(() => parseUniSms({ [field]: value }));

    expect(error.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: [field] })]),
    );
  });

  it("allows disabled SMS without UniSMS credentials", () => {
    expect(parseEnv({ ...base, SMS_DELIVERY_MODE: "disabled" }).SMS_DELIVERY_MODE).toBe("disabled");
  });

  it("accepts live UniSMS credentials in unisms mode", () => {
    const env = parseUniSms({});

    expect(env.UNISMS_API_KEY).toBe("live-api-key");
    expect(env.UNISMS_SENDER_ID).toBe("ReferralSandbox");
  });

  it("trims live UniSMS credentials before returning them", () => {
    const env = parseUniSms({
      UNISMS_API_KEY: " live-api-key ",
      UNISMS_SENDER_ID: " ReferralSandbox ",
    });

    expect(env.UNISMS_API_KEY).toBe("live-api-key");
    expect(env.UNISMS_SENDER_ID).toBe("ReferralSandbox");
  });

  it.each([
    ["a non-integer port", { PORT: "4000.5" }],
    ["an out-of-range port", { PORT: "65536" }],
    ["a non-http web origin", { WEB_ORIGIN: "ftp://localhost:3000" }],
    ["a non-PostgreSQL database URL", { DATABASE_URL: "mysql://localhost/referrals" }],
    ["a short session secret", { SESSION_SECRET: "too-short" }],
    ["a short OTP secret", { OTP_HMAC_SECRET: "too-short" }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => parseEnv({ ...base, ...overrides })).toThrow();
  });

  it("does not leak credentials from malformed database URLs", async () => {
    const passwordSentinel = "DATABASE_PASSWORD_SENTINEL_MUST_NOT_LEAK";
    const error = expectZodError(() =>
      parseEnv({
        ...base,
        DATABASE_URL: `postgres://sandbox:${passwordSentinel}@localhost:99999/referral_sandbox`,
      }),
    );

    expect(error.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ["DATABASE_URL"] })]),
    );
    expect(JSON.stringify(error)).not.toContain(passwordSentinel);
    expect(String(error)).not.toContain(passwordSentinel);
    expect(await inspectValue(error)).not.toContain(passwordSentinel);
  });

  it("coerces the SMTP secure flag to a boolean", () => {
    expect(parseEnv({ ...base, SMTP_SECURE: "true" }).SMTP_SECURE).toBe(true);
    expect(parseEnv(base).SMTP_SECURE).toBe(false);
  });

  it.each(["yes", "1", ""])("rejects an invalid SMTP secure value of %j", (value) => {
    expect(() => parseEnv({ ...base, SMTP_SECURE: value })).toThrow();
  });

  it("requires an SMTP host when email delivery is enabled", () => {
    expect(() => parseEnv({ ...base, SMTP_HOST: undefined })).toThrow(/SMTP_HOST/i);
  });

  it("requires an SMTP port when email delivery is enabled", () => {
    expect(() => parseEnv({ ...base, SMTP_PORT: undefined })).toThrow(/SMTP_PORT/i);
  });

  it("freezes the validated environment", () => {
    expect(Object.isFrozen(parseEnv(base))).toBe(true);
  });
});
