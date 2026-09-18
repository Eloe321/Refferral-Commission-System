"use client";

import { WorkbenchPageHeading } from "../../../components/workbench-page-heading";
import { ClaimFlow } from "../claim-flow";
import { ClaimHistory } from "../claim-history";
import { usePartnerWorkspace } from "../partner-workspace-provider";

export function PartnerClaimsPage() {
  const { overview, ledgerEntries, refresh } = usePartnerWorkspace();
  return (
    <div className="route-page">
      <WorkbenchPageHeading
        eyebrow="Verified payout request"
        title="Claims"
        description="Select eligible earnings, authorize the exact total, and inspect the resulting claim and recovery history."
      />
      <ClaimFlow
        earnings={overview.earnings}
        mailpitUrl="http://localhost:8025"
        onClaimCreated={refresh}
      />
      <ClaimHistory claims={overview.claims} ledgerEntries={ledgerEntries} />
    </div>
  );
}
