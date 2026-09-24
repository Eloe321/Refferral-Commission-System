"use client";

import { earningStatuses } from "@referral-sandbox/contracts";
import { Button, Money } from "@referral-sandbox/ui";
import { useMemo } from "react";

import { WorkbenchPageHeading } from "../../../components/workbench-page-heading";
import { useOwnerWorkspace } from "../owner-workspace-provider";

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export function OwnerReportsPage() {
  const { overview, conversions } = useOwnerWorkspace();
  const currency = overview.earnings[0]?.amount.currency ?? conversions[0]?.currency ?? "USD";
  const partnerNames = useMemo(
    () => new Map(overview.partners.map((partner) => [partner.id, partner.displayName])),
    [overview.partners],
  );
  const bookingItems = useMemo(
    () => new Map(conversions.flatMap((conversion) => conversion.items.map((item) => [item.id, { bookingRef: conversion.externalRef, category: item.category }] as const))),
    [conversions],
  );
  const totals = earningStatuses.map((status) => {
    const matches = overview.earnings.filter((earning) => earning.status === status);
    return {
      status,
      count: matches.length,
      amountMinor: matches.reduce((sum, earning) => sum + BigInt(earning.amount.amountMinor), 0n).toString(),
    };
  });
  const reversalMinor = overview.earnings.reduce(
    (sum, earning) => sum + BigInt(earning.reversedAmount.amountMinor),
    0n,
  ).toString();
  const claimReviewCount = overview.claims.filter((claim) => claim.status === "created" || claim.status === "failed").length;
  const byPartner = overview.partners.map((partner) => ({
    id: partner.id,
    name: partner.displayName,
    count: overview.earnings.filter((earning) => earning.partnerId === partner.id).length,
    amountMinor: overview.earnings
      .filter((earning) => earning.partnerId === partner.id)
      .reduce((sum, earning) => sum + BigInt(earning.amount.amountMinor), 0n)
      .toString(),
  }));

  function downloadCsv(): void {
    const header = ["earning_id", "booking_reference", "service_category", "partner", "status", "commission_minor", "reversed_minor", "currency"];
    const rows = overview.earnings.map((earning) => {
      const booking = bookingItems.get(earning.conversionItemId);
      return [
        earning.id,
        booking?.bookingRef ?? "",
        booking?.category ?? "",
        partnerNames.get(earning.partnerId) ?? "",
        earning.status,
        earning.amount.amountMinor,
        earning.reversedAmount.amountMinor,
        earning.amount.currency,
      ];
    });
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "northstar-commission-report.csv";
    anchor.click();
    window.setTimeout(() => { URL.revokeObjectURL(url); }, 0);
  }

  return (
    <div className="route-page">
      <WorkbenchPageHeading
        eyebrow="Operations report"
        title="Commission exposure"
        description="Review outstanding commission, owner claim work, and refund reversals. Export item-level figures in exact minor units."
      />
      <section className="owner-panel" aria-labelledby="report-summary-title">
        <div className="owner-panel__heading">
          <div><p className="eyebrow">Current ledger view</p><h2 id="report-summary-title">Status totals</h2></div>
          <Button onClick={() => { downloadCsv(); }}>Export CSV</Button>
        </div>
        <div className="report-metrics">
          {totals.map(({ status, count, amountMinor }) => (
            <article key={status} className="report-metric">
              <span>{status.replaceAll("_", " ")} · {count} earnings</span>
              <strong><Money amountMinor={amountMinor} currency={currency} /></strong>
            </article>
          ))}
        </div>
        <p>{claimReviewCount} claims need owner review. Refund reversal exposure: <Money amountMinor={reversalMinor} currency={currency} />.</p>
        <p className="owner-empty">Amounts are simulated. CSV values use integer minor units for accounting review.</p>
      </section>
      <section className="owner-panel" aria-labelledby="report-partners-title">
        <div className="owner-panel__heading"><div><p className="eyebrow">Partner channels</p><h2 id="report-partners-title">Earnings by partner</h2></div></div>
        <div className="report-metrics">
          {byPartner.map((partner) => (
            <article className="report-metric" key={partner.id}>
              <span>{partner.name} · {partner.count} earnings</span>
              <strong><Money amountMinor={partner.amountMinor} currency={currency} /></strong>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
