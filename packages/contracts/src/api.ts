import { z } from "zod";
import {
  actorRoles,
  partnerStatuses,
  programStatuses,
  conversionStatuses,
  earningStatuses,
  otpStatuses,
  claimStatuses,
  deliveryChannels,
  outboxStatuses,
} from "./domain.js";
import {
  moneyJsonSchema,
  nonnegativeMinorStringSchema,
  nonnegativeMoneyJsonSchema,
  signedAggregateMinorStringSchema,
  unsignedAggregateMinorStringSchema,
  POSTGRES_BIGINT_MAX,
  POSTGRES_BIGINT_MIN,
} from "./money.js";

const uuid = z.uuid();
const currency = z.string().regex(/^[A-Z]{3}$/);
const category = z.string().trim().min(1).max(80);
const externalRef = z.string().trim().min(1).max(120);
const earningIds = z.array(uuid).min(1).max(100);
const timestamp = z.iso.datetime({ offset: true });

export const demoSessionInput = z.strictObject({ role: z.enum(actorRoles), actorId: uuid });
export const flatRuleInput = z.strictObject({
  type: z.literal("flat"),
  category: category.nullable(),
  partnerId: uuid.nullable(),
  flatAmountMinor: nonnegativeMinorStringSchema,
  basisPoints: z.null(),
  effectiveFrom: timestamp.optional(),
  effectiveTo: timestamp.nullable().optional(),
});
export const percentageRuleInput = z.strictObject({
  type: z.literal("percentage"),
  category: category.nullable(),
  partnerId: uuid.nullable(),
  flatAmountMinor: z.null(),
  basisPoints: z.number().int().min(1).max(10000),
  effectiveFrom: timestamp.optional(),
  effectiveTo: timestamp.nullable().optional(),
});
export const commissionRuleInput = z
  .discriminatedUnion("type", [flatRuleInput, percentageRuleInput])
  .superRefine((rule, context) => {
    if (
      rule.effectiveTo &&
      Date.parse(rule.effectiveTo) <= Date.parse(rule.effectiveFrom ?? new Date().toISOString())
    )
      context.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "effectiveTo must be after effectiveFrom",
      });
  });
export const createProgramInput = z.strictObject({ name: z.string().trim().min(3).max(100) });
export const createReferralCodeInput = z.strictObject({
  partnerId: uuid,
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/),
});
export const referralCodeSchema = z.strictObject({
  id: uuid,
  programId: uuid,
  partnerId: uuid,
  code: z.string(),
  active: z.boolean(),
});
export const previewCommissionInput = z.strictObject({
  partnerId: uuid,
  category,
  grossAmountMinor: nonnegativeMinorStringSchema,
});
export const previewCommissionSchema = z.strictObject({
  ruleId: uuid.nullable(),
  programStatus: z.enum(programStatuses),
  scope: z.enum(["partner_category", "partner", "category", "fallback", "none"]),
  amount: moneyJsonSchema,
});
export const createConversionInput = z.strictObject({
  idempotencyKey: z.string().trim().min(8).max(120),
  externalRef,
  programId: uuid,
  referralCode: z.string().trim().min(3).max(40),
  currency,
  items: z
    .array(
      z.strictObject({ externalRef, category, grossAmountMinor: nonnegativeMinorStringSchema }),
    )
    .min(1)
    .max(20),
});
export const reasonInput = z.strictObject({ reason: z.string().trim().min(3).max(240) });
const positiveMinorStringSchema = nonnegativeMinorStringSchema.refine(
  (value) => BigInt(value) > 0n,
  { message: "Amount must be positive" },
);
export const refundInput = z.strictObject({
  reason: reasonInput.shape.reason,
  items: z
    .array(z.strictObject({ conversionItemId: uuid, refundedBaseMinor: positiveMinorStringSchema }))
    .min(1)
    .max(20)
    .refine(
      (items) =>
        new Set(items.map((item) => item.conversionItemId.toLowerCase())).size === items.length,
    ),
});
export const createOtpChallengeInput = z.strictObject({
  earningIds: earningIds.refine(
    (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
  ),
  channel: z.enum(deliveryChannels),
});
export const verifyOtpInput = z.strictObject({ code: z.string().regex(/^[0-9]{6}$/) });
export const createClaimInput = z.strictObject({
  challengeId: uuid,
  earningIds: earningIds.refine(
    (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
  ),
});
export const simulateClaimInput = z.strictObject({ outcome: z.enum(["success", "failure"]) });
export const resetSandboxInput = z.strictObject({ confirmation: z.literal("RESET SANDBOX") });

const recordIdentity = { id: uuid, organizationId: uuid };
const recordTimes = { createdAt: timestamp, updatedAt: timestamp };
const commissionRuleBase = {
  ...recordIdentity,
  programId: uuid,
  partnerId: uuid.nullable(),
  category: category.nullable(),
  effectiveFrom: timestamp,
  effectiveTo: timestamp.nullable(),
};
export const commissionRuleSchema = z
  .discriminatedUnion("type", [
    z.strictObject({
      ...commissionRuleBase,
      type: z.literal("flat"),
      flatAmount: nonnegativeMoneyJsonSchema,
      basisPoints: z.null(),
    }),
    z.strictObject({
      ...commissionRuleBase,
      type: z.literal("percentage"),
      flatAmount: z.null(),
      basisPoints: z.number().int().min(1).max(10000),
    }),
  ])
  .superRefine((rule, context) => {
    if (
      rule.effectiveTo !== null &&
      Date.parse(rule.effectiveTo) <= Date.parse(rule.effectiveFrom)
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "effectiveTo must be after effectiveFrom",
      });
    }
  });
export const programSchema = z.strictObject({
  ...recordIdentity,
  ...recordTimes,
  name: z.string(),
  status: z.enum(programStatuses),
  rules: z.array(commissionRuleSchema),
});
export const partnerSchema = z.strictObject({
  ...recordIdentity,
  ...recordTimes,
  userId: uuid,
  displayName: z.string(),
  email: z.email(),
  phoneE164: z.string(),
  status: z.enum(partnerStatuses),
});
export const signedMinorStringSchema = z
  .string()
  .regex(/^-?[0-9]+$/)
  .refine(
    (value) =>
      /^-?[0-9]+$/.test(value) &&
      BigInt(value) >= BigInt(POSTGRES_BIGINT_MIN) &&
      BigInt(value) <= BigInt(POSTGRES_BIGINT_MAX),
  );
export const partnerBalanceSchema = z.strictObject({
  currency,
  ledgerMinor: signedAggregateMinorStringSchema,
  eligibleMinor: unsignedAggregateMinorStringSchema,
  heldMinor: unsignedAggregateMinorStringSchema,
});
export const partnerDetailSchema = partnerSchema.extend({
  balances: z.array(partnerBalanceSchema),
});
export const conversionItemSchema = z.strictObject({
  ...recordIdentity,
  conversionId: uuid,
  externalRef,
  category,
  grossAmount: nonnegativeMoneyJsonSchema,
  refundedBase: nonnegativeMoneyJsonSchema,
});
export const conversionSchema = z.strictObject({
  ...recordIdentity,
  ...recordTimes,
  programId: uuid,
  partnerId: uuid,
  referralCodeId: uuid,
  externalRef,
  currency,
  status: z.enum(conversionStatuses),
  items: z.array(conversionItemSchema),
});
export const earningHoldSchema = z.strictObject({
  ...recordIdentity,
  earningId: uuid,
  previousStatus: z.enum(["pending", "eligible", "reserved"]),
  reason: z.string(),
  placedBy: uuid,
  releasedBy: uuid.nullable(),
  placedAt: timestamp,
  releasedAt: timestamp.nullable(),
});
export const earningSchema = z.strictObject({
  ...recordIdentity,
  ...recordTimes,
  conversionItemId: uuid,
  programId: uuid,
  partnerId: uuid,
  ruleId: uuid.nullable(),
  amount: moneyJsonSchema,
  reversedAmount: moneyJsonSchema,
  status: z.enum(earningStatuses),
  ruleSnapshot: z.record(z.string(), z.unknown()),
  holds: z.array(earningHoldSchema),
});
export const earningViewSchema = earningSchema.extend({
  statusExplanation: z.string().min(1),
});
export const earningListSchema = z.strictObject({ items: z.array(earningViewSchema) });
export const bookingWebhookEventSchema = z.strictObject({
  id: uuid,
  providerEventId: z.string().min(1).max(120),
  programId: uuid,
  bookingRef: externalRef,
  eventType: z.literal("service.completed"),
  occurredAt: timestamp,
  status: z.enum(["pending", "processed", "failed", "ignored"]),
  failureCode: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  createdAt: timestamp,
  lastAttemptAt: timestamp.nullable(),
  processedAt: timestamp.nullable(),
  confirmationStatus: z.enum(outboxStatuses).nullable(),
});
export const bookingWebhookEventListSchema = z.strictObject({
  items: z.array(bookingWebhookEventSchema),
});
export const bookingWebhookReceiptSchema = z.strictObject({
  status: z.enum(["processed", "duplicate", "failed", "ignored"]),
});
export const otpDeliverySchema = z.strictObject({
  ...recordIdentity,
  channel: z.enum(deliveryChannels),
  status: z.enum(otpStatuses),
  deliveryStatus: z.enum(outboxStatuses),
  maskedRecipient: z.string(),
  attempts: z.number().int().nonnegative(),
  expiresAt: timestamp,
  resendAfter: timestamp,
});
export const claimItemSchema = z.strictObject({
  ...recordIdentity,
  claimId: uuid,
  earningId: uuid,
  amount: moneyJsonSchema,
});
export const claimSchema = z.strictObject({
  ...recordIdentity,
  ...recordTimes,
  partnerId: uuid,
  actorId: uuid,
  amount: moneyJsonSchema,
  status: z.enum(claimStatuses),
  idempotencyKey: z.string(),
  selectionHash: z.string(),
  items: z.array(claimItemSchema),
});
export const claimListSchema = z.strictObject({ items: z.array(claimSchema) });
export const ownerClaimOtpAuditSchema = z.strictObject({
  challengeId: uuid,
  channel: z.enum(deliveryChannels),
  status: z.enum(otpStatuses),
  attempts: z.number().int().nonnegative(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export const ownerClaimSchema = claimSchema.extend({
  otpAudit: ownerClaimOtpAuditSchema.nullable(),
});
export const ownerClaimListSchema = z.strictObject({ items: z.array(ownerClaimSchema) });
export const ledgerEntrySchema = z.strictObject({
  ...recordIdentity,
  partnerId: uuid,
  earningId: uuid.nullable(),
  claimId: uuid.nullable(),
  entryType: z.enum(["accrual", "payout", "reversal", "adjustment"]),
  amount: moneyJsonSchema,
  reason: z.string().nullable(),
  createdAt: timestamp,
});
export const auditEventSchema = z.strictObject({
  ...recordIdentity,
  eventKey: z.string(),
  actorId: uuid.nullable(),
  isSystemEvent: z.boolean(),
  action: z.string(),
  reason: z.string().nullable(),
  aggregateType: z.string(),
  aggregateId: uuid,
  metadata: z.record(z.string(), z.unknown()),
  createdAt: timestamp,
});
export const demoSessionSchema = z.strictObject({
  organizationId: uuid,
  actorId: uuid,
  role: z.enum(actorRoles),
  partnerId: uuid.nullable(),
  displayName: z.string(),
  sandboxVersion: z.number().int().nonnegative(),
});
export const demoScenarioId = "northstar-referral-lifecycle" as const;
export const guideStages = [
  "review_program",
  "switch_to_partner",
  "create_referral",
  "complete_service",
  "claim_earnings",
  "switch_to_owner",
  "issue_refund",
  "review_reversal",
  "complete",
] as const;
export const guideStageSchema = z.enum(guideStages);
export const guideStateSchema = z.strictObject({
  organizationId: uuid,
  scenarioId: z.literal(demoScenarioId),
  stage: guideStageSchema,
  sandboxVersion: z.number().int().nonnegative(),
  completedStages: z.array(guideStageSchema),
  updatedAt: timestamp,
});
export const guideAdvanceResponseSchema = guideStateSchema;
export const publicReferralSchema = z
  .strictObject({
    code: z.string().trim().min(3).max(40),
    publicUrl: z.url(),
  })
  .superRefine((referral, context) => {
    const url = new URL(referral.publicUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "referrals.example.invalid" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== `/r/${encodeURIComponent(referral.code)}`
    ) {
      context.addIssue({ code: "custom", path: ["publicUrl"], message: "Unsafe referral URL" });
    }
  });
const demoWorkspaceBase = {
  organizationId: uuid,
  sandboxVersion: z.number().int().nonnegative(),
};
export const ownerDemoWorkspaceSchema = z.strictObject({
  ...demoWorkspaceBase,
  role: z.literal("owner"),
  conversions: z.array(conversionSchema),
  auditEvents: z.array(auditEventSchema),
});
export const partnerDemoWorkspaceSchema = z.strictObject({
  ...demoWorkspaceBase,
  role: z.literal("partner"),
  partnerId: uuid,
  referral: publicReferralSchema,
  ledgerEntries: z.array(ledgerEntrySchema),
});
export const demoWorkspaceSchema = z.discriminatedUnion("role", [
  ownerDemoWorkspaceSchema,
  partnerDemoWorkspaceSchema,
]);
export const resetSandboxResponseSchema = z.strictObject({
  session: demoSessionSchema,
  guide: guideStateSchema,
});

export type DemoSessionInput = z.infer<typeof demoSessionInput>;
export type CommissionRuleInput = z.infer<typeof commissionRuleInput>;
export type CreateProgramInput = z.infer<typeof createProgramInput>;
export type CreateReferralCodeInput = z.infer<typeof createReferralCodeInput>;
export type ReferralCode = z.infer<typeof referralCodeSchema>;
export type PreviewCommissionInput = z.infer<typeof previewCommissionInput>;
export type PreviewCommission = z.infer<typeof previewCommissionSchema>;
export type CreateConversionInput = z.infer<typeof createConversionInput>;
export type ReasonInput = z.infer<typeof reasonInput>;
export type RefundInput = z.infer<typeof refundInput>;
export type CreateOtpChallengeInput = z.infer<typeof createOtpChallengeInput>;
export type VerifyOtpInput = z.infer<typeof verifyOtpInput>;
export type CreateClaimInput = z.infer<typeof createClaimInput>;
export type ResetSandboxInput = z.infer<typeof resetSandboxInput>;
export type Program = z.infer<typeof programSchema>;
export type CommissionRule = z.infer<typeof commissionRuleSchema>;
export type Partner = z.infer<typeof partnerSchema>;
export type PartnerDetail = z.infer<typeof partnerDetailSchema>;
export type Conversion = z.infer<typeof conversionSchema>;
export type ConversionItem = z.infer<typeof conversionItemSchema>;
export type Earning = z.infer<typeof earningSchema>;
export type EarningView = z.infer<typeof earningViewSchema>;
export type BookingWebhookEvent = z.infer<typeof bookingWebhookEventSchema>;
export type BookingWebhookReceipt = z.infer<typeof bookingWebhookReceiptSchema>;
export type EarningHold = z.infer<typeof earningHoldSchema>;
export type OtpDelivery = z.infer<typeof otpDeliverySchema>;
export type Claim = z.infer<typeof claimSchema>;
export type ClaimItem = z.infer<typeof claimItemSchema>;
export type OwnerClaim = z.infer<typeof ownerClaimSchema>;
export type OwnerClaimOtpAudit = z.infer<typeof ownerClaimOtpAuditSchema>;
export type LedgerEntry = z.infer<typeof ledgerEntrySchema>;
export type AuditEvent = z.infer<typeof auditEventSchema>;
export type DemoSession = z.infer<typeof demoSessionSchema>;
export type GuideState = z.infer<typeof guideStateSchema>;
export type GuideStage = z.infer<typeof guideStageSchema>;
export type GuideAdvanceResponse = z.infer<typeof guideAdvanceResponseSchema>;
export type PublicReferral = z.infer<typeof publicReferralSchema>;
export type DemoWorkspace = z.infer<typeof demoWorkspaceSchema>;
export type OwnerDemoWorkspace = z.infer<typeof ownerDemoWorkspaceSchema>;
export type PartnerDemoWorkspace = z.infer<typeof partnerDemoWorkspaceSchema>;
export type ResetSandboxResponse = z.infer<typeof resetSandboxResponseSchema>;
