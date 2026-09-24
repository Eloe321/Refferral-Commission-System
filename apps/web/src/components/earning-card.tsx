import type { EarningView } from "@referral-sandbox/contracts";
import { Money, StatusBadge } from "@referral-sandbox/ui";
import Link from "next/link";
import type { ReactNode } from "react";

export type EarningCardProps = {
  earning: EarningView;
  action: ReactNode;
  reference?: string;
};

export function EarningCard({ earning, action, reference }: EarningCardProps) {
  const category =
    typeof earning.ruleSnapshot.category === "string"
      ? earning.ruleSnapshot.category
      : "Rule exception";
  const latestHold = earning.holds.at(-1);
  const selectedRule = earning.ruleId
    ? earning.ruleSnapshot.partnerId
      ? "A partner override took priority."
      : earning.ruleSnapshot.category
        ? "A service category rule took priority over the program fallback."
        : "The program fallback applied because no more specific rule matched."
    : "No active commission rule matched this booking item.";
  const nextAction =
    earning.status === "pending"
      ? "Deliver the booking completion event to make this commission eligible."
      : earning.status === "eligible"
        ? "The partner can request a claim with OTP authorization."
        : earning.status === "held"
          ? "The owner can review and release or void the hold."
          : earning.status === "needs_rule"
            ? "The owner needs to configure a matching rule for future bookings."
            : earning.status === "reserved"
              ? "The claim is awaiting owner settlement review."
              : "Review the claim and audit trail for any later recovery or reversal.";

  return (
    <tr className="earning-card">
      <td data-label="Work item">
        <strong>{reference ?? category}</strong>
        <span>{category}</span>
        <details className="earning-explanation">
          <summary>Why this commission?</summary>
          <p>{selectedRule}</p>
          {BigInt(earning.reversedAmount.amountMinor) > 0n ? (
            <p>Refund reversal: <Money {...earning.reversedAmount} />.</p>
          ) : null}
          <p>{nextAction}</p>
          {reference ? <p><Link href="/owner/bookings">View completion events for {reference}</Link></p> : null}
        </details>
      </td>
      <td data-label="Status">
        <StatusBadge status={earning.status} />
        <span>{earning.statusExplanation}</span>
        {latestHold ? (
          <span className="earning-hold-reason">Reason: {latestHold.reason}</span>
        ) : null}
      </td>
      <td data-label="Commission">
        <Money {...earning.amount} />
      </td>
      <td data-label="Action">{action}</td>
    </tr>
  );
}
