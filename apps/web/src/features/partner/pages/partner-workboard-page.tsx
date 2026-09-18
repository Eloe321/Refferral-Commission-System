"use client";

import { formatMoneyMinor } from "@referral-sandbox/ui";
import Link from "next/link";

import { MetricCard } from "../../../components/metric-card";
import { usePartnerWorkspace } from "../partner-workspace-provider";

export function PartnerWorkboardPage() {
  const { overview, referral, financials } = usePartnerWorkspace();
  const { currency, available, pending, held } = financials;
  const recoveryApplied = BigInt(financials.recoveryApplied);
  const recoveryRemaining = BigInt(financials.recoveryRemaining);
  const debt = BigInt(financials.recoveryDebt);
  const eligible = BigInt(available) + recoveryApplied;
  const availableLabel = formatMoneyMinor({ amountMinor: available, currency });
  const recoveryAppliedLabel = formatMoneyMinor({
    amountMinor: recoveryApplied.toString(),
    currency,
  });
  const recoveryRemainingLabel = formatMoneyMinor({
    amountMinor: recoveryRemaining.toString(),
    currency,
  });
  const debtLabel = formatMoneyMinor({ amountMinor: debt.toString(), currency });
  const displayFirstName = overview.partner.displayName.split(/\s+/)[0] ?? "Partner";
  const nextAction =
    BigInt(available) > 0n
      ? recoveryApplied > 0n
        ? `Claim ${availableLabel} after ${recoveryAppliedLabel} balance recovery. Verification keeps the payout tied to this partner.`
        : "Claim available earnings next. Verification keeps the payout tied to this partner."
      : debt > 0n
        ? eligible > 0n
          ? recoveryRemaining > 0n
            ? `Eligible earnings are assigned to recovery. ${recoveryRemainingLabel} balance recovery remains before a payout becomes available.`
            : "All eligible earnings are assigned to balance recovery, so no payout is available yet."
          : `New eligible earnings will first repay ${debtLabel} balance recovery before a payout becomes available.`
        : BigInt(pending) > 0n
          ? "Complete the referred service before its commission becomes claimable."
          : "Share the public referral link to start the next fictional work order.";
  const recoveryNote =
    recoveryRemaining > 0n
      ? recoveryApplied > 0n
        ? `${recoveryAppliedLabel} applied · ${recoveryRemainingLabel} recovery remains`
        : `${debtLabel} recovery balance outstanding`
      : recoveryApplied > 0n
        ? `${recoveryAppliedLabel} balance recovery`
        : "Ready for verification";

  return (
    <div className="partner-workboard">
      <header className="partner-hero">
        <div>
          <p className="eyebrow">Partner pass {referral.code} · Referral operations</p>
          <h1 tabIndex={-1}>Partner workboard · {displayFirstName}</h1>
          <p>
            Track fictional commissions, share a public referral pass, and authorize a payout with a
            short-lived code.
          </p>
        </div>
        <span className="partner-hero__stamp">Identity checked at claim</span>
      </header>

      {financials.incompleteRecovery ? (
        <p className="partner-notice partner-notice--info" role="status">
          Some open claim recovery could not be reconciled. This available estimate is conservative.
        </p>
      ) : null}

      <section className="partner-metrics" aria-label="Partner commission totals">
        <MetricCard
          label="Available"
          value={{ amountMinor: available, currency }}
          note={recoveryNote}
          tone="success"
        />
        <MetricCard
          label="Pending"
          value={{ amountMinor: pending, currency }}
          note="Waiting on service completion"
        />
        <MetricCard
          label="Held"
          value={{ amountMinor: held, currency }}
          note="Paused for owner review"
          tone="warning"
        />
      </section>

      <aside className="partner-next-action" aria-label="Recommended next action">
        <span>Next dispatch</span>
        <p>{nextAction}</p>
      </aside>

      <div className="route-inline-actions">
        <Link className="ui-button ui-button--secondary" href="/partner/referrals">
          Open referral pass
        </Link>
        <Link className="ui-button ui-button--primary" href="/partner/claims">
          Open claim controls
        </Link>
      </div>
    </div>
  );
}
