"use client";

import { WorkbenchPageHeading } from "../../../components/workbench-page-heading";
import { ReferralCodeCard } from "../referral-code-card";
import { usePartnerWorkspace } from "../partner-workspace-provider";

export function PartnerReferralsPage() {
  const { referral } = usePartnerWorkspace();
  return (
    <div className="route-page">
      <WorkbenchPageHeading
        eyebrow="Referral pass"
        title="Referrals"
        description="Share one fictional code and see how attribution connects a future business event to this partner."
      />
      <ReferralCodeCard referral={referral} />
      <p className="route-explainer">
        The same attribution point can represent a service booking, retail order, attended
        appointment, or first subscription invoice.
      </p>
    </div>
  );
}
