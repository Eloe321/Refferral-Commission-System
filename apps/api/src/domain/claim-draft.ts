import { createHash } from "node:crypto";

export type ClaimDraft = {
  organizationId: string;
  actorId: string;
  partnerId: string;
  earningIds: readonly string[];
  amountMinor: string;
  currency: string;
};
export const MAX_CLAIM_AMOUNT = 9223372036854775807n;
// PostgreSQL UUID identity is case-insensitive; preserve non-UUID domain labels.
const canonicalIdentity = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
    ? id.toLowerCase()
    : id;
export function createClaimDraftHash(draft: ClaimDraft): string {
  const earningIds = draft.earningIds.map(canonicalIdentity);
  if (
    !draft.organizationId ||
    !draft.actorId ||
    !draft.partnerId ||
    !draft.earningIds.length ||
    draft.earningIds.some((id) => !id) ||
    new Set(earningIds).size !== earningIds.length ||
    !/^(0|[1-9]\d*)$/.test(draft.amountMinor) ||
    BigInt(draft.amountMinor) > MAX_CLAIM_AMOUNT ||
    !/^[A-Z]{3}$/.test(draft.currency)
  )
    throw new Error("Invalid claim draft");
  return createHash("sha256")
    .update(
      JSON.stringify({
        organizationId: canonicalIdentity(draft.organizationId),
        actorId: canonicalIdentity(draft.actorId),
        partnerId: canonicalIdentity(draft.partnerId),
        earningIds: earningIds.sort(),
        amountMinor: draft.amountMinor,
        currency: draft.currency,
      }),
    )
    .digest("hex");
}
