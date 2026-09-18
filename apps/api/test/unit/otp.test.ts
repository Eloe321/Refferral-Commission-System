import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { OtpPolicy, generateOtpCode, type OtpChallengeRow } from "../../src/otp/otp.service.js";
import { PreviewSmsAdapter } from "../../src/notifications/preview-sms.adapter.js";
import { EmailAdapter } from "../../src/notifications/email.adapter.js";
import { challengeDeliverySchema } from "@referral-sandbox/contracts";
import type { AppEnv } from "../../src/config/env.js";

const env = {
  APP_MODE: "sandbox",
  SMS_DELIVERY_MODE: "preview",
  EMAIL_DELIVERY_MODE: "mailpit",
  OTP_HMAC_SECRET: "unit-secret-is-at-least-thirty-two-characters",
} as AppEnv;
describe("OTP policy and delivery boundaries", () => {
  it("generates six digits and a challenge-bound HMAC with exact expiry and cooldown", () => {
    for (let i = 0; i < 100; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
    const clock = () => new Date("2026-09-16T00:00:00Z");
    const policy = new OtpPolicy(env, clock, () => "000042");
    const issued = policy.issue("challenge");
    expect(issued.code).toBe("000042");
    expect(issued.codeDigest).toBe(
      createHmac("sha256", env.OTP_HMAC_SECRET).update("challenge:000042").digest("hex"),
    );
    expect(issued.expiresAt.toISOString()).toBe("2026-09-16T00:05:00.000Z");
    expect(issued.resendAfter.toISOString()).toBe("2026-09-16T00:01:00.000Z");
    expect(policy.matches("challenge", "000042", issued.codeDigest)).toBe(true);
    expect(policy.matches("other", "000042", issued.codeDigest)).toBe(false);
    expect(policy.matches("challenge", "000043", issued.codeDigest)).toBe(false);
    expect(policy.matches("challenge", "000042", "bad")).toBe(false);
  });
  it("gates preview on both sandbox and preview and validates strict delivery variants", () => {
    const input = {
      recipient: "+12025550132",
      code: "000042",
      expiresAt: new Date("2026-09-16T00:05:00Z"),
    };
    const preview = new PreviewSmsAdapter(env).preview(input);
    expect(preview).toMatchObject({
      mode: "preview",
      preview: { code: "000042", recipientMasked: "***0132" },
    });
    expect(JSON.stringify(preview)).not.toContain(input.recipient);
    challengeDeliverySchema.parse(preview);
    expect(new PreviewSmsAdapter({ ...env, APP_MODE: "production" }).preview(input)).toEqual({
      mode: "disabled",
      status: "unavailable",
    });
    expect(new PreviewSmsAdapter({ ...env, SMS_DELIVERY_MODE: "disabled" }).preview(input)).toEqual(
      { mode: "disabled", status: "unavailable" },
    );
    for (const mode of ["provider", "disabled"])
      expect(
        challengeDeliverySchema.safeParse({
          mode,
          status: mode === "provider" ? "queued" : "unavailable",
          code: "000042",
        }).success,
      ).toBe(false);
  });
  it("checks expiry and resend precisely at the fake clock boundaries", () => {
    let now = new Date("2026-09-16T00:00:00Z");
    const policy = new OtpPolicy(
      env,
      () => now,
      () => "000042",
    );
    const row = {
      status: "pending",
      attempts: 0,
      expires_at: new Date(now.getTime() + 300_000),
      resend_after: new Date(now.getTime() + 60_000),
    } as OtpChallengeRow;
    expect(() => {
      policy.assertPending(row);
    }).not.toThrow();
    expect(() => {
      policy.assertResendAllowed(row);
    }).toThrow();
    now = new Date(now.getTime() + 60_000);
    expect(() => {
      policy.assertResendAllowed(row);
    }).not.toThrow();
    now = new Date(now.getTime() + 240_000);
    expect(() => {
      policy.assertPending(row);
    }).toThrow();
    for (const status of ["blocked", "used", "verified", "expired"] as const)
      expect(() => {
        policy.assertPending({ ...row, status });
      }).toThrow();
  });
  it("binds organization, actor, partner and expected authoritative hash without consuming attempts", () => {
    const policy = new OtpPolicy(
      env,
      () => new Date(),
      () => "000042",
    );
    const actor = {
      actorId: "actor",
      organizationId: "org",
      partnerId: "partner",
      role: "partner" as const,
      displayName: "Test",
      sandboxVersion: 1,
    };
    const row = {
      organization_id: "org",
      actor_id: "actor",
      partner_id: "partner",
      claim_draft_hash: "hash",
      attempts: 0,
    } as OtpChallengeRow;
    expect(() => {
      policy.assertBinding(row, actor, "hash");
    }).not.toThrow();
    for (const field of ["organizationId", "actorId", "partnerId"] as const)
      expect(() => {
        policy.assertBinding(row, { ...actor, [field]: "other" });
      }).toThrow();
    expect(() => {
      policy.assertBinding(row, actor, "changed");
    }).toThrow();
    expect(row.attempts).toBe(0);
  });
  it("blocks on exactly the fifth failure and preserves attempts on success", () => {
    const policy = new OtpPolicy(
      env,
      () => new Date(),
      () => "000042",
    );
    for (let attempts = 0; attempts < 5; attempts++)
      expect(policy.verificationResult(attempts, false)).toEqual({
        attempts: attempts + 1,
        status: attempts === 4 ? "blocked" : "pending",
      });
    expect(policy.verificationResult(3, true)).toEqual({ attempts: 3, status: "verified" });
  });
  it("never reuses a resend code even when the generator repeats and rejects malformed generator output", () => {
    const codes = ["000042", "000042", "000043"];
    const policy = new OtpPolicy(
      env,
      () => new Date(),
      () => codes.shift() ?? "000043",
    );
    const issued = policy.issue("same-id");
    const rotated = policy.issue("same-id", issued.codeDigest);
    expect(rotated.code).toBe("000043");
    expect(policy.matches("same-id", issued.code, rotated.codeDigest)).toBe(false);
    expect(() => policy.issue("same-id", rotated.codeDigest)).toThrow("OTP generation unavailable");
    expect(() =>
      new OtpPolicy(
        env,
        () => new Date(),
        () => "42",
      ).issue("id"),
    ).toThrow();
  });
  it("reuses one SMTP transporter with Mailpit defaults and neutral send failures", async () => {
    const sendMail = vi.fn().mockResolvedValue({ messageId: "fictional" });
    const close = vi.fn();
    const factory = vi.fn(() => ({ sendMail, close }));
    const adapter = new EmailAdapter(env, factory);
    await adapter.send({ recipient: "test@example.invalid", content: "Fictional OTP 000042" });
    await adapter.send({ recipient: "test@example.invalid", content: "Second message" });
    expect(factory).toHaveBeenCalledExactlyOnceWith({ host: "mailpit", port: 1025, secure: false });
    expect(sendMail).toHaveBeenCalledTimes(2);
    sendMail.mockRejectedValue(new Error("smtp credential or message content"));
    await expect(
      adapter.send({ recipient: "test@example.invalid", content: "Secret" }),
    ).rejects.toThrow("Email delivery unavailable");
    adapter.onApplicationShutdown();
    expect(close).toHaveBeenCalledOnce();
  });
  it("uses configured SMTP options and never sends through a disabled email adapter", async () => {
    const sendMail = vi.fn();
    const factory = vi.fn(() => ({ sendMail, close: vi.fn() }));
    const adapter = new EmailAdapter(
      {
        ...env,
        EMAIL_DELIVERY_MODE: "disabled",
        SMTP_HOST: "smtp.example.invalid",
        SMTP_PORT: 465,
        SMTP_SECURE: true,
      },
      factory,
    );
    expect(factory).toHaveBeenCalledExactlyOnceWith({
      host: "smtp.example.invalid",
      port: 465,
      secure: true,
    });
    await expect(
      adapter.send({ recipient: "test@example.invalid", content: "No network" }),
    ).rejects.toThrow("Email delivery unavailable");
    expect(sendMail).not.toHaveBeenCalled();
  });
});
