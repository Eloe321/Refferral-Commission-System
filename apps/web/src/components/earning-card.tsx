import type { EarningView } from "@referral-sandbox/contracts";
import { Money, StatusBadge } from "@referral-sandbox/ui";
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

  return (
    <tr className="earning-card">
      <td data-label="Work item">
        <strong>{reference ?? category}</strong>
        <span>{category}</span>
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
