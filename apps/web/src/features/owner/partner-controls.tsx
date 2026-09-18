"use client";

import type { PartnerDetail } from "@referral-sandbox/contracts";
import { Money, StatusBadge } from "@referral-sandbox/ui";

import { ApiError, changePartnerState } from "../../lib/api-client";
import { ActionSheet } from "./action-sheet";
import type { OperationNotice } from "./earning-controls";

export type PartnerControlsProps = {
  partners: PartnerDetail[];
  settledByPartner: ReadonlyMap<string, ReadonlyMap<string, string>>;
  onChanged: () => Promise<void>;
  onNotice: (notice: OperationNotice) => void;
};

export function PartnerControls({
  partners,
  settledByPartner,
  onChanged,
  onNotice,
}: PartnerControlsProps) {
  return (
    <section id="partners" className="owner-panel" aria-labelledby="partners-title">
      <div className="owner-panel__heading">
        <div>
          <p className="eyebrow">Partner roster</p>
          <h2 id="partners-title">Partner access</h2>
        </div>
        <p>Suspension protects open earnings; reactivation restores new referral access.</p>
      </div>
      <div className="partner-list">
        {partners.map((partner) => (
          <article className="partner-record" key={partner.id}>
            <div>
              <h3>{partner.displayName}</h3>
              <p>{partner.email}</p>
            </div>
            <StatusBadge status={partner.status} />
            <dl className="partner-balances">
              {partner.balances.map((balance) => (
                <div key={balance.currency}>
                  <dt>Available balance</dt>
                  <dd>
                    <Money amountMinor={balance.eligibleMinor} currency={balance.currency} />
                  </dd>
                  <dt>Held balance</dt>
                  <dd>
                    <Money amountMinor={balance.heldMinor} currency={balance.currency} />
                  </dd>
                  <dt>Settled claims</dt>
                  <dd>
                    <Money
                      amountMinor={settledByPartner.get(partner.id)?.get(balance.currency) ?? "0"}
                      currency={balance.currency}
                    />
                  </dd>
                </div>
              ))}
            </dl>
            <ActionSheet
              title={`${partner.displayName} controls`}
              triggerLabel={`Manage ${partner.displayName}`}
              actions={[
                partner.status === "active"
                  ? {
                      id: "suspend",
                      label: "Suspend partner",
                      description: "Block new activity and protect open commissions with holds.",
                      reasonRequired: true,
                      tone: "danger",
                    }
                  : {
                      id: "reactivate",
                      label: "Reactivate partner",
                      description: "Restore the partner's access for new referrals.",
                      reasonRequired: true,
                    },
              ]}
              onAction={async (action, reason) => {
                try {
                  const updated = await changePartnerState(
                    partner.id,
                    action as "suspend" | "reactivate",
                    reason,
                  );
                  await onChanged();
                  onNotice({
                    kind: "success",
                    message: `${updated.displayName} is now ${updated.status}.`,
                  });
                  return true;
                } catch (error) {
                  onNotice({
                    kind: "error",
                    message:
                      error instanceof ApiError
                        ? error.message.replaceAll("_", " ")
                        : "Partner update failed. Try again.",
                  });
                  return false;
                }
              }}
            />
          </article>
        ))}
      </div>
    </section>
  );
}
