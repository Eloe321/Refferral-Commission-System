"use client";

import { WorkbenchPageHeading } from "../../../components/workbench-page-heading";
import { ActivityFeed } from "../activity-feed";
import { ClaimMonitor } from "../claim-monitor";
import { ConversionControls } from "../conversion-controls";
import { OwnerEarningsQueue } from "../owner-earnings-queue";
import { OwnerNotices, useOwnerWorkspace } from "../owner-workspace-provider";

export function OwnerEarningsPage() {
  const {
    overview,
    conversions,
    auditEvents,
    referenceByItem,
    refresh,
    replaceConversion,
    setNotice,
  } = useOwnerWorkspace();
  return (
    <div className="route-page">
      <WorkbenchPageHeading
        eyebrow="Commission queue"
        title="Earnings and settlement"
        description="Review claimability, stop exceptions, simulate settlement, and trace later recovery."
      />
      <OwnerNotices />
      <OwnerEarningsQueue
        earnings={overview.earnings}
        referenceByItem={referenceByItem}
        onChanged={refresh}
        onNotice={setNotice}
      />
      <ClaimMonitor claims={overview.claims} onChanged={refresh} onNotice={setNotice} />
      <ConversionControls
        mode="refund"
        conversions={conversions}
        onChanged={async (updated) => {
          replaceConversion(updated);
          await refresh();
        }}
        onNotice={setNotice}
      />
      <ActivityFeed events={auditEvents} />
    </div>
  );
}
