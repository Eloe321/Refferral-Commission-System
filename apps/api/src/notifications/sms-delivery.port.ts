export type { PreviewSms, ChallengeDelivery } from "@referral-sandbox/contracts";
export type DeliveryMessage = { recipient: string; content: string };
/** Task 11's UniSmsAdapter implements this worker-facing port; issuance never sends. */
export interface SmsDeliveryPort {
  send(message: DeliveryMessage): Promise<{ referenceId: string }>;
}
export function maskRecipient(recipient: string, channel: "sms" | "email"): string {
  if (channel === "sms") return `***${recipient.slice(-4)}`;
  const [local, domain] = recipient.split("@");
  return `${local?.slice(0, 1) ?? ""}***@${domain?.slice(0, 1) ?? ""}***`;
}
