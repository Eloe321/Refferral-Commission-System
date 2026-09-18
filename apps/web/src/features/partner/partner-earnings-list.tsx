import type { EarningView } from "@referral-sandbox/contracts";
import { Money, StatusBadge } from "@referral-sandbox/ui";

export function PartnerEarningsList({ earnings }: { earnings: EarningView[] }) {
  if (earnings.length === 0) {
    return <p className="owner-empty">Create the guided referral to see earning states here.</p>;
  }
  return (
    <div className="partner-earning-list">
      {earnings.map((earning) => (
        <article
          className="partner-earning-card"
          key={earning.id}
          aria-label={`Earning ${earning.id.slice(0, 8)}`}
        >
          <div>
            <strong>
              {typeof earning.ruleSnapshot.category === "string"
                ? earning.ruleSnapshot.category
                : "General service"}
            </strong>
            <StatusBadge status={earning.status} />
          </div>
          <Money {...earning.amount} />
          <p>{earning.statusExplanation}</p>
        </article>
      ))}
    </div>
  );
}
