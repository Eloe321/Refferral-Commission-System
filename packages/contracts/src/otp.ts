import { z } from "zod";

export const previewSmsSchema = z.strictObject({
  recipientMasked: z.string(),
  message: z.string(),
  code: z.string().regex(/^\d{6}$/),
  expiresAt: z.iso.datetime(),
});
export type PreviewSms = z.infer<typeof previewSmsSchema>;
export const challengeDeliverySchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("preview"), preview: previewSmsSchema }),
  z.strictObject({ mode: z.literal("provider"), status: z.literal("queued") }),
  z.strictObject({ mode: z.literal("disabled"), status: z.literal("unavailable") }),
]);
export type ChallengeDelivery = z.infer<typeof challengeDeliverySchema>;
export const otpChallengeStateSchema = z.strictObject({
  id: z.uuid(),
  status: z.enum(["pending", "verified", "blocked", "expired", "used"]),
  channel: z.enum(["sms", "email"]),
  maskedRecipient: z.string(),
  attempts: z.number().int().min(0).max(5),
  attemptsRemaining: z.number().int().min(0).max(5),
  expiresAt: z.iso.datetime(),
  resendAfter: z.iso.datetime(),
});
export const otpChallengeResponseSchema = otpChallengeStateSchema.extend({
  delivery: challengeDeliverySchema,
});
