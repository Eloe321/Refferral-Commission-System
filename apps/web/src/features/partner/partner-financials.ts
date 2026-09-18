import type { PartnerOverview } from "../../lib/api-client";

export type PartnerFinancials = {
  currency: string;
  available: string;
  pending: string;
  held: string;
  recoveryApplied: string;
  recoveryRemaining: string;
  recoveryDebt: string;
  incompleteRecovery: boolean;
};

type PartnerClaim = PartnerOverview["claims"][number];
type ClaimAssociation = { claim: PartnerClaim; item: PartnerClaim["items"][number] };

function pendingTotal(overview: PartnerOverview, currency: string): string {
  return overview.earnings
    .filter((earning) => earning.status === "pending" && earning.amount.currency === currency)
    .reduce((total, earning) => total + BigInt(earning.amount.amountMinor), 0n)
    .toString();
}

function openClaimRecovery(
  overview: PartnerOverview,
  currency: string,
): { amount: bigint; incomplete: boolean } {
  const earnings = new Map(overview.earnings.map((earning) => [earning.id, earning]));
  const associations = new Map<string, ClaimAssociation[]>();
  let amount = 0n;
  let incomplete = false;

  for (const claim of overview.claims) {
    if (claim.status !== "created" && claim.status !== "processing") {
      continue;
    }
    if (claim.items.length === 0) {
      incomplete = true;
      continue;
    }
    for (const item of claim.items) {
      const existing = associations.get(item.earningId) ?? [];
      existing.push({ claim, item });
      associations.set(item.earningId, existing);
    }
  }

  for (const [earningId, matches] of associations) {
    if (matches.length !== 1) {
      incomplete = true;
      continue;
    }
    const association = matches[0];
    if (!association) {
      incomplete = true;
      continue;
    }
    if (association.claim.amount.currency !== currency) continue;
    const earning = earnings.get(earningId);
    if (
      !earning ||
      association.claim.organizationId !== overview.partner.organizationId ||
      association.claim.partnerId !== overview.partner.id ||
      association.item.organizationId !== association.claim.organizationId ||
      association.item.claimId !== association.claim.id ||
      earning.organizationId !== association.claim.organizationId ||
      earning.partnerId !== association.claim.partnerId ||
      earning.status !== "reserved" ||
      association.item.amount.currency !== currency ||
      earning.amount.currency !== currency
    ) {
      incomplete = true;
      continue;
    }
    const earningAmount = BigInt(earning.amount.amountMinor);
    const payoutAmount = BigInt(association.item.amount.amountMinor);
    const recovery = earningAmount - payoutAmount;
    if (earningAmount < 0n || payoutAmount < 0n || recovery < 0n) {
      incomplete = true;
      continue;
    }
    amount += recovery;
  }

  return { amount, incomplete };
}

export function projectPartnerFinancials(overview: PartnerOverview): PartnerFinancials {
  const balance = overview.partner.balances[0];
  const currency = balance?.currency ?? overview.earnings[0]?.amount.currency ?? "USD";
  const eligibleRaw = BigInt(balance?.eligibleMinor ?? "0");
  const eligible = eligibleRaw > 0n ? eligibleRaw : 0n;
  const ledger = BigInt(balance?.ledgerMinor ?? "0");
  const reservedRecovery = openClaimRecovery(overview, currency);
  const projectedLedger = ledger + reservedRecovery.amount;
  const debt = projectedLedger < 0n ? -projectedLedger : 0n;
  const recoveryApplied = debt < eligible ? debt : eligible;
  const recoveryRemaining = debt - recoveryApplied;
  return {
    currency,
    available: (eligible - recoveryApplied).toString(),
    pending: pendingTotal(overview, currency),
    held: balance?.heldMinor ?? "0",
    recoveryApplied: recoveryApplied.toString(),
    recoveryRemaining: recoveryRemaining.toString(),
    recoveryDebt: debt.toString(),
    incompleteRecovery: reservedRecovery.incomplete,
  };
}
