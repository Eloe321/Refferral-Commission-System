"use client";

import type { Claim, EarningView } from "@referral-sandbox/contracts";
import { Button, Money, StatusBadge } from "@referral-sandbox/ui";
import { Mail, MessageSquareText, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { OtpInput } from "../../components/otp-input";
import { SmsPreviewDrawer } from "../../components/sms-preview-drawer";
import {
  ApiError,
  createClaim,
  createOtpChallenge,
  resendOtpChallenge,
  verifyOtpChallenge,
} from "../../lib/api-client";

type OtpChallenge = Awaited<ReturnType<typeof createOtpChallenge>>;
type ClaimNotice = { kind: "success" | "error" | "info"; message: string };

export type ClaimFlowProps = {
  earnings: EarningView[];
  mailpitUrl?: string;
  onClaimCreated?: (claim: Claim) => Promise<void> | void;
};

function earningLabel(earning: EarningView): { category: string; reference: string } {
  return {
    category:
      typeof earning.ruleSnapshot.category === "string" ? earning.ruleSnapshot.category : "service",
    reference:
      typeof earning.ruleSnapshot.externalRef === "string"
        ? earning.ruleSnapshot.externalRef
        : earning.conversionItemId.slice(0, 8),
  };
}

function errorNotice(error: unknown): ClaimNotice {
  if (!(error instanceof ApiError))
    return { kind: "error", message: "The claim request could not be completed. Try again." };
  if (error.message === "invalid_code") {
    const remaining = error.details.attemptsRemaining;
    return {
      kind: "error",
      message:
        remaining === undefined
          ? "That code did not match. Check the six digits and try again."
          : `That code did not match. ${String(remaining)} attempt${remaining === 1 ? "" : "s"} remaining.`,
    };
  }
  if (error.message === "challenge_blocked")
    return { kind: "error", message: "This code is blocked. Request a new code to continue." };
  if (error.message === "challenge_expired")
    return { kind: "error", message: "This code expired. Request a new code to continue." };
  if (error.message === "resend_cooldown" || error.message === "issuance_cooldown")
    return { kind: "error", message: "A new code is not ready yet. Wait for the cooldown." };
  if (error.message === "selection_unavailable")
    return {
      kind: "error",
      message: "One selected earning is no longer available. Refresh the workboard.",
    };
  return { kind: "error", message: "The claim request could not be completed. Try again." };
}

export function ClaimFlow({
  earnings,
  mailpitUrl = "http://localhost:8025",
  onClaimCreated,
}: ClaimFlowProps) {
  const eligible = earnings.filter((earning) => earning.status === "eligible");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [channel, setChannel] = useState<"sms" | "email">("sms");
  const [smsDisabled, setSmsDisabled] = useState(false);
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [code, setCode] = useState("");
  const [pendingAction, setPendingAction] = useState<"challenge" | "claim" | "resend" | null>(null);
  const [notice, setNotice] = useState<ClaimNotice | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const actionGuard = useRef(false);
  const claimKey = useRef<string | null>(null);
  const otpRef = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  const selectedEarnings = useMemo(
    () => eligible.filter((earning) => selected[earning.id]),
    [eligible, selected],
  );
  const selectedCurrency =
    selectedEarnings[0]?.amount.currency ?? eligible[0]?.amount.currency ?? "USD";
  const selectedTotal = selectedEarnings.reduce(
    (total, earning) => total + BigInt(earning.amount.amountMinor),
    0n,
  );
  const mixedCurrency = selectedEarnings.some(
    (earning) => earning.amount.currency !== selectedCurrency,
  );
  const serverRelativeNow = challenge
    ? challenge.serverNowMs + Math.max(0, clock - challenge.receivedAtClientMs)
    : clock;
  const terminalChallenge =
    challenge?.status === "expired" ||
    challenge?.status === "blocked" ||
    (challenge?.status === "pending" && Date.parse(challenge.expiresAt) <= serverRelativeNow);
  const resendSeconds = challenge
    ? Math.max(0, Math.ceil((Date.parse(challenge.resendAfter) - serverRelativeNow) / 1_000))
    : 0;

  useEffect(() => {
    if (!challenge || challenge.status === "verified" || (terminalChallenge && resendSeconds <= 0))
      return;
    const timer = window.setInterval(() => {
      setClock(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [challenge, resendSeconds, terminalChallenge]);

  useEffect(() => {
    if (notice?.kind !== "success") return;
    const frame = window.requestAnimationFrame(() => {
      noticeRef.current?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [notice]);

  function acceptChallenge(next: OtpChallenge) {
    if (next.delivery.mode === "disabled") {
      if (next.channel === "sms") {
        setSmsDisabled(true);
        setChannel("email");
      }
      setChallenge(null);
      setNotice({
        kind: "error",
        message:
          next.channel === "sms"
            ? "SMS is unavailable in this sandbox."
            : "Email is unavailable in this sandbox.",
      });
      return;
    }
    setChallenge(next);
    setClock(Date.now());
    setCode("");
    claimKey.current = null;
    if (next.delivery.mode === "preview") {
      setPreviewOpen(true);
      setNotice({ kind: "info", message: "Local SMS preview ready." });
    } else if (next.channel === "email") {
      setNotice({ kind: "info", message: "Verification email queued in the local Mailpit inbox." });
    } else {
      setNotice({
        kind: "info",
        message: "SMS queued for delivery. Enter the code when it arrives.",
      });
    }
  }

  async function beginChallenge() {
    if (actionGuard.current || !selectedEarnings.length || mixedCurrency) return;
    actionGuard.current = true;
    setPendingAction("challenge");
    setNotice(null);
    try {
      acceptChallenge(
        await createOtpChallenge(
          selectedEarnings.map((earning) => earning.id),
          channel,
        ),
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.message === "channel_unavailable" &&
        channel === "sms"
      ) {
        setSmsDisabled(true);
        setChannel("email");
        setNotice({
          kind: "error",
          message: "SMS is unavailable in this sandbox.",
        });
      } else {
        setNotice(errorNotice(error));
      }
    } finally {
      actionGuard.current = false;
      setPendingAction(null);
    }
  }

  async function confirmClaim() {
    if (actionGuard.current || !challenge || (challenge.status !== "verified" && code.length !== 6))
      return;
    actionGuard.current = true;
    setPendingAction("claim");
    setNotice(null);
    let challengeVerified = challenge.status === "verified";
    try {
      if (challenge.status !== "verified") {
        const verified = await verifyOtpChallenge(challenge.id, code);
        setChallenge({ ...challenge, ...verified });
        challengeVerified = verified.status === "verified";
      }
      const key = claimKey.current ?? crypto.randomUUID();
      claimKey.current = key;
      const created = await createClaim(
        challenge.id,
        selectedEarnings.map((earning) => earning.id),
        key,
      );
      setNotice({
        kind: "success",
        message: "Claim created. The server is processing the payout.",
      });
      setSelected({});
      setChallenge(null);
      setCode("");
      claimKey.current = null;
      try {
        const refresh = onClaimCreated?.(created);
        if (refresh) {
          void Promise.resolve(refresh).catch(() => {
            setNotice({
              kind: "info",
              message: "Claim created, but the workboard could not refresh yet.",
            });
          });
        }
      } catch {
        setNotice({
          kind: "info",
          message: "Claim created, but the workboard could not refresh yet.",
        });
      }
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.message === "challenge_expired" || error.message === "challenge_blocked")
      ) {
        setChallenge((current) =>
          current
            ? {
                ...current,
                status: error.message === "challenge_expired" ? "expired" : "blocked",
              }
            : current,
        );
        setCode("");
        setPreviewOpen(false);
        claimKey.current = null;
        setNotice(errorNotice(error));
      } else if (challengeVerified) {
        setNotice({
          kind: "error",
          message:
            "Code verified, but the claim was not created. Retry claim; no new code is needed.",
        });
      } else {
        setNotice(errorNotice(error));
      }
    } finally {
      actionGuard.current = false;
      setPendingAction(null);
    }
  }

  async function requestAnotherCode() {
    if (actionGuard.current || !challenge) return;
    actionGuard.current = true;
    setPendingAction("resend");
    setNotice(null);
    try {
      acceptChallenge(
        terminalChallenge
          ? await createOtpChallenge(
              selectedEarnings.map((earning) => earning.id),
              challenge.channel,
            )
          : await resendOtpChallenge(challenge.id),
      );
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.message === "challenge_expired" || error.message === "challenge_blocked")
      ) {
        setChallenge((current) =>
          current
            ? {
                ...current,
                status: error.message === "challenge_expired" ? "expired" : "blocked",
              }
            : current,
        );
        setCode("");
        setPreviewOpen(false);
        claimKey.current = null;
      }
      if (
        terminalChallenge &&
        error instanceof ApiError &&
        error.message === "issuance_cooldown" &&
        error.details.resendAfter
      ) {
        setChallenge((current) =>
          current
            ? { ...current, resendAfter: error.details.resendAfter ?? current.resendAfter }
            : current,
        );
        setClock(Date.now());
      }
      setNotice(errorNotice(error));
    } finally {
      actionGuard.current = false;
      setPendingAction(null);
    }
  }

  return (
    <section
      id="earnings"
      className="partner-panel partner-claim"
      aria-labelledby="claim-flow-title"
    >
      <div className="partner-panel__heading">
        <div>
          <p className="eyebrow">Claim manifest</p>
          <h2 id="claim-flow-title">Available earnings</h2>
        </div>
        <p>
          Select fictional earnings, choose a verification channel, and let the server authorize the
          claim.
        </p>
      </div>

      {eligible.length ? (
        <div className="partner-earning-list">
          {eligible.map((earning) => {
            const label = earningLabel(earning);
            const currencyMismatch =
              selectedEarnings.length > 0 && earning.amount.currency !== selectedCurrency;
            return (
              <article className="partner-earning-card" key={earning.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected[earning.id] ?? false}
                    disabled={currencyMismatch || pendingAction !== null}
                    aria-label={`Select ${label.category} referral ${label.reference}`}
                    onChange={(event) => {
                      if (actionGuard.current) return;
                      setSelected((current) => ({
                        ...current,
                        [earning.id]: event.target.checked,
                      }));
                      setChallenge(null);
                      setCode("");
                      setNotice(null);
                      claimKey.current = null;
                    }}
                  />
                  <span>
                    <strong>{label.reference}</strong>
                    <span>{label.category} referral</span>
                  </span>
                </label>
                <div>
                  <StatusBadge status={earning.status} />
                  <Money {...earning.amount} />
                </div>
                <p>{earning.statusExplanation}</p>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="owner-empty">No earnings are eligible for a claim yet.</p>
      )}

      <fieldset className="claim-channels" disabled={pendingAction !== null || challenge !== null}>
        <legend>Verification channel</legend>
        <label>
          <input
            aria-label="SMS"
            type="radio"
            name="claim-channel"
            value="sms"
            checked={channel === "sms"}
            disabled={smsDisabled}
            onChange={() => {
              setChannel("sms");
            }}
          />
          <MessageSquareText aria-hidden="true" size={18} />
          <span>
            <strong>SMS</strong>
            <small>
              {smsDisabled
                ? "Unavailable in this sandbox"
                : "Preview by default; optional live provider"}
            </small>
          </span>
        </label>
        <label>
          <input
            aria-label="Email"
            type="radio"
            name="claim-channel"
            value="email"
            checked={channel === "email"}
            onChange={() => {
              setChannel("email");
            }}
          />
          <Mail aria-hidden="true" size={18} />
          <span>
            <strong>Email</strong>
            <small>Captured locally in Mailpit</small>
          </span>
        </label>
      </fieldset>
      {challenge ? (
        <p className="claim-helper">
          Channel locked to {challenge.channel.toUpperCase()} for this challenge.
        </p>
      ) : null}
      {smsDisabled ? (
        <p className="claim-helper">Use local email while SMS delivery is disabled.</p>
      ) : null}

      {challenge ? (
        <div className="otp-work-order">
          <div>
            <ShieldCheck aria-hidden="true" size={22} />
            <div>
              <strong>Challenge {challenge.id.slice(0, 8)}</strong>
              <p>Code sent to {challenge.maskedRecipient}</p>
            </div>
          </div>
          {challenge.channel === "email" ? (
            <a href={mailpitUrl} target="_blank" rel="noreferrer">
              Open Mailpit inbox
            </a>
          ) : null}
          {challenge.delivery.mode === "preview" && !terminalChallenge && !previewOpen ? (
            <Button
              variant="quiet"
              onClick={() => {
                setPreviewOpen(true);
              }}
            >
              <MessageSquareText aria-hidden="true" size={16} /> Reopen SMS preview
            </Button>
          ) : null}
          <OtpInput
            ref={otpRef}
            value={code}
            onChange={setCode}
            disabled={
              pendingAction !== null || terminalChallenge || challenge.status === "verified"
            }
          />
          {challenge.status !== "verified" ? (
            <Button
              variant="quiet"
              onClick={() => void requestAnotherCode()}
              disabled={pendingAction !== null || resendSeconds > 0}
            >
              <RotateCcw aria-hidden="true" size={16} />
              {pendingAction === "resend"
                ? terminalChallenge
                  ? "Requesting fresh code…"
                  : "Requesting code…"
                : resendSeconds > 0
                  ? `${terminalChallenge ? "Fresh" : "New"} code available in ${String(resendSeconds)}s`
                  : terminalChallenge
                    ? "Request fresh code"
                    : "Request new code"}
            </Button>
          ) : (
            <p className="claim-helper">Code verified. Retry the claim; no new code is needed.</p>
          )}
          {challenge.status !== "verified" && resendSeconds > 0 ? (
            <p className="claim-helper">
              Server {terminalChallenge ? "issuance" : "resend"} cooldown: wait{" "}
              {String(resendSeconds)} seconds before requesting another code.
            </p>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <p
          ref={noticeRef}
          tabIndex={-1}
          className={`partner-notice partner-notice--${notice.kind}`}
          role={notice.kind === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          {notice.message}
        </p>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <footer className="partner-claim-footer" data-testid="claim-footer">
        <div>
          <span>Estimated selected earnings</span>
          <Money amountMinor={selectedTotal.toString()} currency={selectedCurrency} />
          <small>Server confirms the actual payout after balance recovery.</small>
        </div>
        <Button
          onClick={() => {
            if (challenge) void confirmClaim();
            else void beginChallenge();
          }}
          disabled={
            pendingAction !== null ||
            !selectedEarnings.length ||
            mixedCurrency ||
            terminalChallenge ||
            (challenge !== null && challenge.status !== "verified" && code.length !== 6)
          }
        >
          {pendingAction === "challenge"
            ? "Preparing verification…"
            : pendingAction === "claim"
              ? "Confirming claim…"
              : terminalChallenge
                ? "Fresh code required"
                : challenge
                  ? challenge.status === "verified"
                    ? "Retry claim"
                    : "Confirm claim"
                  : "Verify claim"}
        </Button>
      </footer>

      {challenge?.delivery.mode === "preview" && !terminalChallenge ? (
        <SmsPreviewDrawer
          open={previewOpen}
          preview={challenge.delivery.preview}
          serverNowMs={challenge.serverNowMs}
          receivedAtClientMs={challenge.receivedAtClientMs}
          onOpenChange={setPreviewOpen}
          focusAfterClose={() => {
            const input = otpRef.current;
            input?.focus();
            if (input && "scrollIntoView" in input) {
              window.requestAnimationFrame(() => {
                input.scrollIntoView({ block: "center", behavior: "auto" });
              });
            }
          }}
          onCopied={() => {
            setPreviewOpen(false);
            setAnnouncement("Code copied. Enter it in the verification code field.");
          }}
        />
      ) : null}
    </section>
  );
}
