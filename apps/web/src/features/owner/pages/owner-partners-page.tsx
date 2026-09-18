"use client";

import { WorkbenchPageHeading } from "../../../components/workbench-page-heading";
import { PartnerControls } from "../partner-controls";
import { OwnerNotices, useOwnerWorkspace } from "../owner-workspace-provider";

export function OwnerPartnersPage() {
  const { overview, settledByPartner, refresh, setNotice } = useOwnerWorkspace();
  return (
    <div className="route-page">
      <WorkbenchPageHeading
        eyebrow="Partner roster"
        title="Partner access"
        description="Inspect balances and pause or restore referral access without deleting financial history."
      />
      <OwnerNotices />
      <PartnerControls
        partners={overview.partners}
        settledByPartner={settledByPartner}
        onChanged={refresh}
        onNotice={setNotice}
      />
    </div>
  );
}
