"use client";

import type { PartnerDetail, PreviewCommission, Program, ReferralCode } from "@referral-sandbox/contracts";
import { Button, Money, StatusBadge } from "@referral-sandbox/ui";
import { useEffect, useState, type SyntheticEvent } from "react";

import { ApiError, changeProgramState, createCommissionProgram, createCommissionRule, createReferralCode, getReferralCodes, previewCommission } from "../../lib/api-client";
import { parseRefundMajorToMinor } from "../../lib/refund-money";
import { ActionSheet } from "./action-sheet";
import type { OperationNotice } from "./earning-controls";

export type ProgramRulesProps = {
  programs: Program[];
  partners: PartnerDetail[];
  onChanged: () => Promise<void>;
  onNotice: (notice: OperationNotice) => void;
};

export function ProgramRules({ programs, partners, onChanged, onNotice }: ProgramRulesProps) {
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [scope, setScope] = useState<"fallback" | "category" | "partner">("category");
  const [category, setCategory] = useState("plumbing");
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? "");
  const [type, setType] = useState<"flat" | "percentage">("percentage");
  const [value, setValue] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [programName, setProgramName] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [codeProgramId, setCodeProgramId] = useState(programs[0]?.id ?? "");
  const [codePartnerId, setCodePartnerId] = useState(partners[0]?.id ?? "");
  const [codes, setCodes] = useState<ReferralCode[]>([]);
  const [previewPartnerId, setPreviewPartnerId] = useState(partners[0]?.id ?? "");
  const [previewCategory, setPreviewCategory] = useState("plumbing");
  const [previewValue, setPreviewValue] = useState("200.00");
  const [preview, setPreview] = useState<PreviewCommission | null>(null);
  const currency = partners[0]?.balances[0]?.currency ?? "USD";

  useEffect(() => {
    if (!codeProgramId) return;
    let active = true;
    void getReferralCodes(codeProgramId).then((items) => {
      if (active) setCodes(items);
    }).catch(() => {
      if (active) setCodes([]);
    });
    return () => { active = false; };
  }, [codeProgramId]);

  async function addRule(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (!programs.some((program) => program.id === programId)) {
      setError("Choose a commission program.");
      return;
    }
    const categoryValue = scope === "category" ? category.trim() : null;
    const partnerValue = scope === "partner" ? partnerId : null;
    let input;
    try {
      if (type === "flat") {
        input = {
          type: "flat" as const,
          category: categoryValue,
          partnerId: partnerValue,
          flatAmountMinor: parseRefundMajorToMinor(value, currency),
          basisPoints: null,
        };
      } else {
        const basisPoints = Number(value) * 100;
        if (!Number.isInteger(basisPoints) || basisPoints < 1 || basisPoints > 10000) {
          throw new Error("Invalid percentage");
        }
        input = {
          type: "percentage" as const,
          category: categoryValue,
          partnerId: partnerValue,
          flatAmountMinor: null,
          basisPoints,
        };
      }
    } catch {
      setError(type === "flat" ? "Enter a valid flat amount." : "Enter a percentage from 0.01 to 100.");
      return;
    }
    setBusy(true);
    try {
      await createCommissionRule(programId, input);
      setPreview(null);
      await onChanged();
      onNotice({ kind: "success", message: "Commission rule created for future bookings." });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message.replaceAll("_", " ") : "Rule could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function addProgram(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const created = await createCommissionProgram({ name: programName });
      setProgramName("");
      setProgramId(created.id);
      setPreview(null);
      setCodeProgramId(created.id);
      await onChanged();
      onNotice({ kind: "success", message: `Program ${created.name} created. Add a rule and partner code to use it.` });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message.replaceAll("_", " ") : "Program could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function addCode(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const created = await createReferralCode(codeProgramId, { partnerId: codePartnerId, code: referralCode });
      setReferralCode("");
      setCodes((current) => [...current, created].sort((left, right) => left.code.localeCompare(right.code)));
      onNotice({ kind: "success", message: `Referral code ${created.code} assigned to a partner.` });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message.replaceAll("_", " ") : "Referral code could not be assigned.");
    } finally {
      setBusy(false);
    }
  }

  async function showPreview(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const grossAmountMinor = parseRefundMajorToMinor(previewValue, currency);
      setPreview(await previewCommission(programId, {
        partnerId: previewPartnerId,
        category: previewCategory.trim(),
        grossAmountMinor,
      }));
    } catch (cause) {
      setPreview(null);
      setError(cause instanceof ApiError ? cause.message.replaceAll("_", " ") : "Preview could not be calculated.");
    }
  }

  return (
    <section id="programs" className="owner-panel" aria-labelledby="programs-title">
      <div className="owner-panel__heading">
        <div>
          <p className="eyebrow">Rule desk</p>
          <h2 id="programs-title">Programs and rule priority</h2>
        </div>
        <p>A specific partner rule wins first; a category rule wins before the program fallback.</p>
      </div>
      <div className="program-setup">
        <form className="booking-form" onSubmit={(event) => void addProgram(event)}>
          <label>New program name<input value={programName} onChange={(event) => { setProgramName(event.target.value); }} minLength={3} maxLength={100} required placeholder="Home service partners" /></label>
          <div className="booking-form__action"><Button type="submit" disabled={busy}>Create program</Button></div>
        </form>
        <form className="booking-form" onSubmit={(event) => void addCode(event)}>
          <label>Program for referral code<select value={codeProgramId} onChange={(event) => { setCodeProgramId(event.target.value); }} required>{programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}</select></label>
          <label>Partner for referral code<select value={codePartnerId} onChange={(event) => { setCodePartnerId(event.target.value); }} required>{partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.displayName}</option>)}</select></label>
          <label>Referral code<input value={referralCode} onChange={(event) => { setReferralCode(event.target.value.toUpperCase()); }} pattern="[A-Z0-9_-]{3,40}" required placeholder="PARTNER42" /></label>
          <div className="booking-form__action"><Button type="submit" disabled={busy || !codeProgramId || !codePartnerId}>Assign referral code</Button></div>
        </form>
      </div>
      {codes.length ? <div className="referral-code-list" aria-label="Assigned referral codes">{codes.map((code) => (
        <span key={code.id}><strong>{code.code}</strong> · {partners.find((partner) => partner.id === code.partnerId)?.displayName ?? "Partner"}</span>
      ))}</div> : null}
      {error ? <p role="alert">{error}</p> : null}
      <form className="booking-form" onSubmit={(event) => void addRule(event)}>
        <label>
          Program
          <select value={programId} onChange={(event) => { setProgramId(event.target.value); setPreview(null); }} required>
            {programs.map((program) => <option key={program.id} value={program.id}>{program.name}</option>)}
          </select>
        </label>
        <label>
          Rule scope
          <select value={scope} onChange={(event) => { setScope(event.target.value as typeof scope); }}>
            <option value="fallback">Program fallback</option>
            <option value="category">Service category</option>
            <option value="partner">Specific partner</option>
          </select>
        </label>
        {scope === "category" ? <label>Service category<input value={category} onChange={(event) => { setCategory(event.target.value); }} required maxLength={80} /></label> : null}
        {scope === "partner" ? <label>Partner<select value={partnerId} onChange={(event) => { setPartnerId(event.target.value); }} required>{partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.displayName}</option>)}</select></label> : null}
        <label>
          Commission type
          <select value={type} onChange={(event) => { setType(event.target.value as typeof type); }}>
            <option value="percentage">Percentage</option>
            <option value="flat">Flat amount</option>
          </select>
        </label>
        <label>
          {type === "percentage" ? "Percent of service value" : `Flat amount (${currency})`}
          <input inputMode="decimal" value={value} onChange={(event) => { setValue(event.target.value); }} required />
        </label>
        <div className="booking-form__action">
          {error ? <p role="alert">{error}</p> : null}
          <Button type="submit" disabled={busy || programs.length === 0 || (scope === "partner" && !partnerId)}>{busy ? "Creating rule…" : "Create rule"}</Button>
        </div>
      </form>
      <form className="booking-form program-preview" onSubmit={(event) => void showPreview(event)}>
        <div className="booking-form__action"><h3>Preview a referred booking</h3><p>The server applies the current rule priority without creating a booking or earning.</p></div>
        <label>Preview partner<select value={previewPartnerId} onChange={(event) => { setPreviewPartnerId(event.target.value); }} required>{partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.displayName}</option>)}</select></label>
        <label>Preview category<input value={previewCategory} onChange={(event) => { setPreviewCategory(event.target.value); }} maxLength={80} required /></label>
        <label>Preview service value<input inputMode="decimal" value={previewValue} onChange={(event) => { setPreviewValue(event.target.value); }} required /></label>
        <div className="booking-form__action"><Button type="submit" disabled={!programId || !previewPartnerId}>Preview commission</Button></div>
        {preview ? <p className="booking-form__action" role="status">
          {preview.scope === "none" ? "No matching rule." : `${preview.scope.replaceAll("_", " ")} rule selected.`}
          {" Estimated commission: "}<Money {...preview.amount} />.
          {preview.programStatus === "paused" ? " The program is paused, so new bookings cannot use this rule yet." : null}
        </p> : null}
      </form>
      <div className="program-list">
        {programs.map((program) => (
          <article className="program-record" key={program.id}>
            <div>
              <h3>{program.name}</h3>
              <StatusBadge status={program.status} />
            </div>
            <ol aria-label={`${program.name} rule priority`}>
              {[...program.rules]
                .sort((left, right) => {
                  const priority = (rule: (typeof program.rules)[number]) =>
                    rule.partnerId ? 0 : rule.category ? 1 : 2;
                  return priority(left) - priority(right);
                })
                .map((rule, index) => (
                  <li key={rule.id}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>
                        {rule.partnerId
                          ? "Partner override"
                          : rule.category
                            ? `${rule.category} category`
                            : "Program fallback"}
                      </strong>
                      <p>
                        {rule.type === "flat" ? (
                          <>
                            Flat <Money {...rule.flatAmount} /> per completed service
                          </>
                        ) : (
                          `${(rule.basisPoints / 100).toFixed(2)}% of the eligible service value`
                        )}
                      </p>
                    </div>
                  </li>
                ))}
            </ol>
            <ActionSheet
              title={`${program.name} controls`}
              triggerLabel={`Manage ${program.name}`}
              actions={[
                program.status === "active"
                  ? {
                      id: "pause",
                      label: "Pause program",
                      description:
                        "Stop new referral attribution while preserving existing records.",
                      reasonRequired: true,
                    }
                  : {
                      id: "resume",
                      label: "Resume program",
                      description: "Allow new referrals to enter this program again.",
                      reasonRequired: true,
                    },
              ]}
              onAction={async (action, reason) => {
                try {
                  const updated = await changeProgramState(
                    program.id,
                    action as "pause" | "resume",
                    reason,
                  );
                  await onChanged();
                  onNotice({
                    kind: "success",
                    message: `${updated.name} is now ${updated.status}.`,
                  });
                  return true;
                } catch (error) {
                  onNotice({
                    kind: "error",
                    message:
                      error instanceof ApiError
                        ? error.message.replaceAll("_", " ")
                        : "Program update failed. Try again.",
                  });
                  return false;
                }
              }}
            />
          </article>
        ))}
      </div>
    </section>
  );
}
