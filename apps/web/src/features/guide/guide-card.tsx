"use client";

import { guideStages, type ActorRole, type GuideStage } from "@referral-sandbox/contracts";
import { Button } from "@referral-sandbox/ui";
import { ArrowRight, CheckCircle2, ClipboardCheck } from "lucide-react";
import { usePathname } from "next/navigation";

import { useGuide } from "./guide-provider";

type StageCopy = {
  title: string;
  action: string;
  why: string;
  industry: string;
  kind: "advance" | "switch" | "check" | "complete";
  role?: ActorRole;
};

const copy: Record<GuideStage, StageCopy> = {
  review_program: {
    title: "Review the commission program",
    action: "Mark program reviewed",
    why: "Rule priority decides who earns, how much, and which terms are frozen for audit.",
    industry: "The same pattern works for repair shops, agencies, and membership businesses.",
    kind: "advance",
  },
  switch_to_partner: {
    title: "See the partner workbench",
    action: "Switch to partner",
    why: "Partners need a focused view of referrals, claimable earnings, and proof of payout.",
    industry: "A role-specific workbench reduces training and support in any referral program.",
    kind: "switch",
    role: "partner",
  },
  create_referral: {
    title: "Create the fictional referral",
    action: "Create referral",
    why: "Attribution connects a public code to a business event without exposing private contact data.",
    industry: "The work order can represent a booking, subscription, invoice, or completed lead.",
    kind: "advance",
  },
  complete_service: {
    title: "Complete the service",
    action: "Complete fictional service",
    why: "Commission becomes eligible only after the business confirms the qualifying outcome.",
    industry: "Eligibility gates adapt to delivered jobs, paid invoices, or passed return windows.",
    kind: "advance",
  },
  claim_earnings: {
    title: "Claim the eligible earning",
    action: "Check claim progress",
    why: "OTP verification and reservation keep a payout request tied to the correct partner and earning.",
    industry: "This control helps any business that needs accountable self-service payouts.",
    kind: "check",
  },
  switch_to_owner: {
    title: "Return to owner controls",
    action: "Switch to owner",
    why: "The owner can inspect the same records without gaining access to partner-only claim creation.",
    industry: "Separated permissions make the pattern reusable across teams and external partners.",
    kind: "switch",
    role: "owner",
  },
  issue_refund: {
    title: "Settle the claim, then issue a refund",
    action: "Check refund progress",
    why: "A real refund reverses the settled commission and leaves an audit trail instead of rewriting history.",
    industry:
      "Recovery ledgers support returns, cancellations, chargebacks, and corrected invoices.",
    kind: "check",
  },
  review_reversal: {
    title: "Review the reversal",
    action: "Mark reversal reviewed",
    why: "The negative ledger entry explains what changed, why it changed, and which earning it affects.",
    industry: "Immutable adjustments make financial operations easier to explain in any business.",
    kind: "check",
  },
  complete: {
    title: "Lifecycle inspection complete",
    action: "Scenario complete",
    why: "You followed attribution, eligibility, verification, payout, refund, and recovery end to end.",
    industry: "Reset the fictional workspace to replay the same controls for another audience.",
    kind: "complete",
  },
};

const destinations: Partial<
  Record<GuideStage, { role: ActorRole; href: string; openLabel: string }>
> = {
  review_program: { role: "owner", href: "/owner/programs", openLabel: "Open programs" },
  create_referral: { role: "partner", href: "/partner/referrals", openLabel: "Open referrals" },
  complete_service: { role: "owner", href: "/owner/programs", openLabel: "Open owner programs" },
  claim_earnings: { role: "partner", href: "/partner/claims", openLabel: "Open partner claims" },
  issue_refund: { role: "owner", href: "/owner/earnings", openLabel: "Open earning operations" },
  review_reversal: { role: "owner", href: "/owner/earnings", openLabel: "Open reversal history" },
};

export function GuideCard() {
  const pathname = usePathname();
  const {
    state,
    pending,
    feedback,
    needsWorkspaceRefresh,
    advance,
    switchPersona,
    openDestination,
  } = useGuide();
  const current = copy[state.stage];
  const destination = destinations[state.stage];
  const needsDestination = destination !== undefined && pathname !== destination.href;
  const step = Math.min(guideStages.indexOf(state.stage) + 1, guideStages.length - 1);
  const action = needsWorkspaceRefresh
    ? advance
    : needsDestination
      ? () => openDestination(destination.role, destination.href)
      : current.kind === "switch" && current.role
        ? () => switchPersona(current.role as ActorRole)
        : advance;

  return (
    <section className="guide-card" aria-labelledby="guide-title">
      <div className="guide-card__progress">
        <span>Step {step} of 8</span>
        <progress value={state.completedStages.length} max={8} aria-label="Guide progress" />
      </div>
      <div className="guide-card__body">
        <ClipboardCheck aria-hidden="true" size={22} />
        <div>
          <p className="eyebrow">Guided business scenario</p>
          <h2 id="guide-title">{current.title}</h2>
          <p>
            <strong>Why it matters:</strong> {current.why}
          </p>
          <p className="guide-card__reuse">Reusable elsewhere: {current.industry}</p>
        </div>
      </div>
      <div className="guide-card__action">
        {current.kind === "complete" && !needsWorkspaceRefresh ? (
          <span className="guide-card__complete">
            <CheckCircle2 aria-hidden="true" size={19} /> {current.action}
          </span>
        ) : (
          <Button disabled={pending} onClick={() => void action()}>
            {pending
              ? "Checking progress…"
              : needsWorkspaceRefresh
                ? "Refresh business records"
                : needsDestination
                  ? destination.openLabel
                  : current.action}
            <ArrowRight aria-hidden="true" size={17} />
          </Button>
        )}
        {feedback ? (
          <p
            className={`guide-card__feedback guide-card__feedback--${feedback.kind}`}
            role={feedback.kind === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {feedback.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
