export const actorRoles = ["owner", "partner"] as const;
export const partnerStatuses = ["active", "suspended"] as const;
export const programStatuses = ["active", "paused"] as const;
export const ruleTypes = ["flat", "percentage"] as const;
export const conversionStatuses = [
  "attributed",
  "scheduled",
  "completed",
  "cancelled",
  "no_show",
  "partially_refunded",
  "refunded",
] as const;
export const earningStatuses = [
  "needs_rule",
  "pending",
  "eligible",
  "held",
  "reserved",
  "settled",
  "voided",
  "reversed",
] as const;
export const otpStatuses = ["pending", "verified", "used", "expired", "blocked"] as const;
export const claimStatuses = ["created", "processing", "settled", "failed"] as const;
export const deliveryChannels = ["sms", "email"] as const;
export const outboxStatuses = [
  "pending",
  "processing",
  "unknown",
  "sent",
  "failed",
  "previewed",
] as const;

export type ActorRole = (typeof actorRoles)[number];
export type PartnerStatus = (typeof partnerStatuses)[number];
export type ProgramStatus = (typeof programStatuses)[number];
export type RuleType = (typeof ruleTypes)[number];
export type ConversionStatus = (typeof conversionStatuses)[number];
export type EarningStatus = (typeof earningStatuses)[number];
export type OtpStatus = (typeof otpStatuses)[number];
export type ClaimStatus = (typeof claimStatuses)[number];
export type DeliveryChannel = (typeof deliveryChannels)[number];
export type OutboxStatus = (typeof outboxStatuses)[number];
