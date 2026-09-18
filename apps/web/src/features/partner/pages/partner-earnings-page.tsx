"use client";

import Link from "next/link";
import { WorkbenchPageHeading } from "../../../components/workbench-page-heading";
import { PartnerEarningsList } from "../partner-earnings-list";
import { usePartnerWorkspace } from "../partner-workspace-provider";

export function PartnerEarningsPage() {
  const { overview, financials } = usePartnerWorkspace();
  return (
    <div className="route-page">
      <WorkbenchPageHeading
        eyebrow="Commission record"
        title="Earnings"
        description="Understand what is waiting, available, held, settled, or reversed before starting a claim."
      />
      <section className="partner-panel" aria-labelledby="partner-earnings-title">
        <div className="partner-panel__heading">
          <div>
            <p className="eyebrow">Status detail</p>
            <h2 id="partner-earnings-title">All earnings</h2>
          </div>
          <p>Every amount carries the server-owned reason for its current state.</p>
        </div>
        <PartnerEarningsList earnings={overview.earnings} />
        {BigInt(financials.available) > 0n ? (
          <Link className="ui-button ui-button--primary route-inline-action" href="/partner/claims">
            Start a claim
          </Link>
        ) : null}
      </section>
    </div>
  );
}
