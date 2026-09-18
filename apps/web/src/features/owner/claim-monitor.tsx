"use client";

import type { OwnerClaim } from "@referral-sandbox/contracts";
import { Button, Money, StatusBadge } from "@referral-sandbox/ui";
import { useRef, useState } from "react";

import { ApiError, retryClaim, simulateClaim } from "../../lib/api-client";
import { ActionSheet } from "./action-sheet";
import type { OperationNotice } from "./earning-controls";

export type ClaimMonitorProps = {
  claims: OwnerClaim[];
  onChanged: () => Promise<void>;
  onNotice: (notice: OperationNotice) => void;
};

export function ClaimMonitor({ claims, onChanged, onNotice }: ClaimMonitorProps) {
  const retryGuard = useRef(new Set<string>());
  const [retryingIds, setRetryingIds] = useState<Set<string>>(() => new Set());
  return (
    <section id="claims" className="owner-panel" aria-labelledby="claims-title">
      <div className="owner-panel__heading">
        <div>
          <p className="eyebrow">Settlement monitor</p>
          <h2 id="claims-title">Claims</h2>
        </div>
        <p>Demo settlement controls never move real money.</p>
      </div>
      <div className="claim-list">
        {claims.map((claim) => (
          <article className="claim-record" key={claim.id}>
            <div>
              <span className="data-id">Claim {claim.id.slice(0, 8)}</span>
              <StatusBadge status={claim.status} />
            </div>
            <Money {...claim.amount} />
            <ul className="claim-items" aria-label={`Claim ${claim.id.slice(0, 8)} contents`}>
              {claim.items.map((item) => (
                <li key={item.id}>
                  <span className="data-id">Earning {item.earningId.slice(0, 8)}</span>
                  <Money {...item.amount} />
                </li>
              ))}
            </ul>
            <p className="claim-audit">
              {claim.otpAudit
                ? `OTP audit · ${claim.otpAudit.channel.toUpperCase()} · ${claim.otpAudit.status} · ${String(claim.otpAudit.attempts)} attempt${claim.otpAudit.attempts === 1 ? "" : "s"}`
                : "OTP audit unavailable for this legacy sandbox claim."}
            </p>
            {["created", "processing"].includes(claim.status) ? (
              <ActionSheet
                title={`Claim ${claim.id.slice(0, 8)}`}
                triggerLabel={`Manage claim ${claim.id.slice(0, 8)}`}
                actions={[
                  {
                    id: "success",
                    label: "Simulate success",
                    description: "Settle the sandbox claim and write its ledger outcome.",
                  },
                  {
                    id: "failure",
                    label: "Simulate failure",
                    description: "Return reserved earnings after a simulated payout failure.",
                    tone: "danger",
                  },
                ]}
                onAction={async (action) => {
                  try {
                    await simulateClaim(claim.id, action as "success" | "failure");
                    await onChanged();
                    onNotice({ kind: "success", message: "Claim settlement simulated." });
                    return true;
                  } catch (error) {
                    onNotice({
                      kind: "error",
                      message:
                        error instanceof ApiError
                          ? error.message.replaceAll("_", " ")
                          : "Claim simulation failed. Try again.",
                    });
                    return false;
                  }
                }}
              />
            ) : claim.status === "failed" ? (
              <Button
                variant="secondary"
                aria-label={`Retry claim ${claim.id.slice(0, 8)}`}
                disabled={retryingIds.has(claim.id)}
                onClick={() => {
                  if (retryGuard.current.has(claim.id)) return;
                  retryGuard.current.add(claim.id);
                  setRetryingIds((current) => new Set(current).add(claim.id));
                  void retryClaim(claim.id)
                    .then(async () => {
                      await onChanged();
                    })
                    .then(() => {
                      onNotice({ kind: "success", message: "Claim payout queued for retry." });
                    })
                    .catch((error: unknown) => {
                      onNotice({
                        kind: "error",
                        message:
                          error instanceof ApiError
                            ? error.message.replaceAll("_", " ")
                            : "Claim retry failed. Try again.",
                      });
                    })
                    .finally(() => {
                      retryGuard.current.delete(claim.id);
                      setRetryingIds((current) => {
                        const next = new Set(current);
                        next.delete(claim.id);
                        return next;
                      });
                    });
                }}
              >
                {retryingIds.has(claim.id) ? "Retry payout…" : "Retry payout"}
              </Button>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
