"use client";

import type { Conversion, EarningView } from "@referral-sandbox/contracts";
import Link from "next/link";

import { MetricCard } from "../../../components/metric-card";
import { OwnerNotices, useOwnerWorkspace } from "../owner-workspace-provider";

function addMoney(earnings: EarningView[], status: string, reversed = false): string {
  return earnings
    .filter((earning) => earning.status === status)
    .reduce(
      (total, earning) =>
        total + BigInt(reversed ? earning.reversedAmount.amountMinor : earning.amount.amountMinor),
      0n,
    )
    .toString();
}

function attributedValue(conversions: Conversion[]): string {
  return conversions
    .flatMap((conversion) => conversion.items)
    .reduce((total, item) => total + BigInt(item.grossAmount.amountMinor), 0n)
    .toString();
}

export function OwnerWorkboardPage() {
  const { overview, conversions, auditEvents } = useOwnerWorkspace();
  const currency = overview.earnings[0]?.amount.currency ?? conversions[0]?.currency ?? "USD";
  const metrics = [
    {
      label: "Attributed",
      amountMinor: attributedValue(conversions),
      note: `${String(conversions.length)} supplied service record${conversions.length === 1 ? "" : "s"}`,
    },
    {
      label: "Pending",
      amountMinor: addMoney(overview.earnings, "pending"),
      note: "Waiting for eligibility",
    },
    {
      label: "Eligible",
      amountMinor: addMoney(overview.earnings, "eligible"),
      note: "Ready for partner claims",
      tone: "success" as const,
    },
    {
      label: "Held",
      amountMinor: addMoney(overview.earnings, "held"),
      note: "Stopped for review",
      tone: "warning" as const,
    },
    {
      label: "Settled",
      amountMinor: addMoney(overview.earnings, "settled"),
      note: "Recorded as paid",
      tone: "success" as const,
    },
    {
      label: "Reversed",
      amountMinor: addMoney(overview.earnings, "reversed", true),
      note: "Removed after refund",
      tone: "danger" as const,
    },
  ];

  return (
    <div className="owner-workboard route-page">
      <header className="owner-hero">
        <div>
          <p className="eyebrow">Work order RC-014 · Owner operations</p>
          <h1 tabIndex={-1}>Owner workboard</h1>
          <p>
            Inspect the rules, exceptions, partner access, and settlement controls behind one
            fictional home-services referral program.
          </p>
        </div>
        <span className="owner-hero__stamp">Local business sandbox</span>
      </header>
      <OwnerNotices />
      <section className="metric-grid" aria-label="Commission totals">
        {metrics.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={{ amountMinor: metric.amountMinor, currency }}
            note={metric.note}
            tone={metric.tone ?? "neutral"}
          />
        ))}
      </section>
      <section className="workbench-snapshot" aria-labelledby="owner-snapshot-title">
        <div>
          <p className="eyebrow">Current operation</p>
          <h2 id="owner-snapshot-title">Lifecycle snapshot</h2>
          <p>
            {conversions.length} attributed records · {overview.claims.length} claims ·{" "}
            {auditEvents.length} observed events
          </p>
        </div>
        <nav aria-label="Owner work shortcuts">
          <Link href="/owner/bookings">Create a referred booking</Link>
          <Link href="/owner/programs">Review program controls</Link>
          <Link href="/owner/earnings">Open earning operations</Link>
        </nav>
      </section>
    </div>
  );
}
