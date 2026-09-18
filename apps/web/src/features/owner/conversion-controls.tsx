"use client";

import type { Conversion } from "@referral-sandbox/contracts";
import { Button, formatMoneyMinor, Money, Sheet, StatusBadge } from "@referral-sandbox/ui";
import { useId, useRef, useState } from "react";

import { ApiError, changeConversionState } from "../../lib/api-client";
import { parseRefundMajorToMinor } from "../../lib/refund-money";
import { ActionSheet, type OwnerAction } from "./action-sheet";
import type { OperationNotice } from "./earning-controls";

export type ConversionControlsProps = {
  mode?: "lifecycle" | "refund";
  conversions: Conversion[];
  onChanged: (conversion: Conversion) => Promise<void>;
  onNotice: (notice: OperationNotice) => void;
};

class RefundAmountValidationError extends Error {
  constructor() {
    super("Invalid refund amount");
    this.name = "RefundAmountValidationError";
  }
}

function parseAdditionalRefund(input: string, currency: string): bigint {
  try {
    return BigInt(parseRefundMajorToMinor(input, currency));
  } catch (error) {
    if (error instanceof TypeError) throw new RefundAmountValidationError();
    throw error;
  }
}

function refundAmountError(input: string, currency: string, remaining: bigint): string | null {
  try {
    const amount = parseAdditionalRefund(input, currency);
    return amount > remaining
      ? `Refund amount exceeds the remaining item value. Remaining amount is ${formatMoneyMinor({ amountMinor: remaining.toString(), currency })}.`
      : null;
  } catch (error) {
    if (error instanceof RefundAmountValidationError)
      return "Enter a positive refund amount using the currency's normal decimal places.";
    throw error;
  }
}

function actionsFor(conversion: Conversion): OwnerAction[] {
  if (conversion.status === "scheduled")
    return [
      {
        id: "complete",
        label: "Complete service",
        description: "Confirm the work and move its commission toward eligibility.",
      },
      {
        id: "cancel",
        label: "Cancel service",
        description: "Record that the service was cancelled.",
        reasonRequired: true,
        tone: "danger",
      },
      {
        id: "no-show",
        label: "Mark no-show",
        description: "Record that the customer did not attend.",
        reasonRequired: true,
        tone: "danger",
      },
    ];
  return [];
}

function RefundSheet({
  conversion,
  onChanged,
  onNotice,
}: {
  conversion: Conversion;
  onChanged: (conversion: Conversion) => Promise<void>;
  onNotice: (notice: OperationNotice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const submitGuard = useRef(false);
  const reasonId = useId();
  const selectedItems = conversion.items.filter((item) => selected[item.id]);
  const amountErrors = new Map(
    selectedItems.map((item) => {
      const remaining =
        BigInt(item.grossAmount.amountMinor) - BigInt(item.refundedBase.amountMinor);
      return [
        item.id,
        refundAmountError(amounts[item.id] ?? "", conversion.currency, remaining),
      ] as const;
    }),
  );
  const canSubmit =
    !pending &&
    selectedItems.length > 0 &&
    [...amountErrors.values()].every((error) => error === null) &&
    reason.trim().length >= 3 &&
    reason.trim().length <= 240;

  function resetDraft() {
    setSelected({});
    setAmounts({});
    setReason("");
    setValidation(null);
  }

  async function submit() {
    if (submitGuard.current) return;
    submitGuard.current = true;
    try {
      const items = conversion.items
        .filter((item) => selected[item.id])
        .map((item) => {
          const remaining =
            BigInt(item.grossAmount.amountMinor) - BigInt(item.refundedBase.amountMinor);
          const additional = parseAdditionalRefund(amounts[item.id] ?? "", conversion.currency);
          if (additional > remaining)
            throw new Error("Refund amount exceeds the remaining item value.");
          return {
            conversionItemId: item.id,
            refundedBaseMinor: (BigInt(item.refundedBase.amountMinor) + additional).toString(),
          };
        });
      if (!items.length) throw new Error("Select at least one service item to refund.");
      if (reason.trim().length < 3) throw new Error("Enter a refund reason.");
      if (reason.trim().length > 240)
        throw new Error("Keep the refund reason to 240 characters or fewer.");
      setValidation(null);
      setPending(true);
      const updated = await changeConversionState(conversion, "refund", reason.trim(), items);
      await onChanged(updated);
      onNotice({
        kind: "success",
        message: `${updated.externalRef} marked ${updated.status.replaceAll("_", " ")}.`,
      });
      resetDraft();
      setOpen(false);
    } catch (error) {
      if (error instanceof ApiError) {
        onNotice({ kind: "error", message: error.message.replaceAll("_", " ") });
        setOpen(false);
      } else {
        setValidation(
          error instanceof RefundAmountValidationError
            ? "Enter a positive refund amount using the currency's normal decimal places."
            : error instanceof Error &&
                [
                  "Refund amount exceeds the remaining item value.",
                  "Select at least one service item to refund.",
                  "Enter a refund reason.",
                  "Keep the refund reason to 240 characters or fewer.",
                ].includes(error.message)
              ? error.message
              : "Check the selected items, refund amounts, and reason.",
        );
      }
    } finally {
      submitGuard.current = false;
      setPending(false);
    }
  }

  return (
    <Sheet
      title={`Refund ${conversion.externalRef}`}
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant="secondary" aria-label={`Manage conversion ${conversion.externalRef}`}>
          Manage
        </Button>
      }
    >
      <p className="refund-sheet__intro">
        Select only the affected service items and enter each additional refund amount.
      </p>
      <div className="refund-items">
        {conversion.items.map((item) => {
          const remaining =
            BigInt(item.grossAmount.amountMinor) - BigInt(item.refundedBase.amountMinor);
          const amountError = amountErrors.get(item.id) ?? null;
          const amountErrorId = `refund-amount-${item.id}-error`;
          return (
            <div className="refund-item" key={item.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected[item.id] ?? false}
                  onChange={(event) => {
                    setSelected((current) => ({ ...current, [item.id]: event.target.checked }));
                    setValidation(null);
                  }}
                />
                {`Refund ${item.category} ${item.externalRef}`}
              </label>
              <label>
                {`Refund amount for ${item.externalRef}`}
                <input
                  inputMode="decimal"
                  pattern="[0-9]+([.][0-9]{1,2})?"
                  maxLength={24}
                  value={amounts[item.id] ?? ""}
                  disabled={!selected[item.id]}
                  aria-invalid={selected[item.id] ? amountError !== null : false}
                  aria-describedby={amountError ? amountErrorId : undefined}
                  onChange={(event) => {
                    setAmounts((current) => ({ ...current, [item.id]: event.target.value }));
                    setValidation(null);
                  }}
                />
              </label>
              <span>
                Remaining{" "}
                <Money amountMinor={remaining.toString()} currency={conversion.currency} />
              </span>
              {amountError ? (
                <span id={amountErrorId} className="refund-item__error" role="alert">
                  {amountError}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <label className="refund-sheet__reason" htmlFor={reasonId}>
        Refund reason
        <textarea
          id={reasonId}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
          rows={3}
          minLength={3}
          maxLength={240}
        />
      </label>
      {validation ? <p role="alert">{validation}</p> : null}
      <Button variant="danger" disabled={!canSubmit} onClick={() => void submit()}>
        {pending ? "Submit refund…" : "Submit refund"}
      </Button>
    </Sheet>
  );
}

export function ConversionControls({
  conversions,
  onChanged,
  onNotice,
  mode = "lifecycle",
}: ConversionControlsProps) {
  const headingId = mode === "refund" ? "refunds-title" : "conversions-title";
  const visibleConversions =
    mode === "refund"
      ? conversions.filter((conversion) =>
          ["completed", "partially_refunded"].includes(conversion.status),
        )
      : conversions;
  return (
    <section className="owner-panel" aria-labelledby={headingId}>
      <div className="owner-panel__heading">
        <div>
          <p className="eyebrow">{mode === "refund" ? "Recovery desk" : "Service dispatch"}</p>
          <h2 id={headingId}>{mode === "refund" ? "Refund adjustments" : "Attributed work"}</h2>
        </div>
        <p>
          {mode === "refund"
            ? "Adjust settled source work without rewriting the original commission history."
            : "Complete, cancel, or record a no-show before commission becomes claimable."}
        </p>
      </div>
      {visibleConversions.length ? (
        <div className="conversion-list">
          {visibleConversions.map((conversion) => (
            <article className="conversion-record" key={conversion.id}>
              <div>
                <span className="data-id">{conversion.externalRef}</span>
                <StatusBadge status={conversion.status} />
              </div>
              <ul>
                {conversion.items.map((item) => (
                  <li key={item.id}>
                    <span>{item.category}</span>
                    <Money {...item.grossAmount} />
                  </li>
                ))}
              </ul>
              {mode === "refund" ? (
                <RefundSheet conversion={conversion} onChanged={onChanged} onNotice={onNotice} />
              ) : conversion.status === "attributed" ? (
                <p className="record-action-unavailable">
                  This attributed record awaits scheduling before service actions are available.
                </p>
              ) : actionsFor(conversion).length ? (
                <ActionSheet
                  title={`Conversion ${conversion.externalRef}`}
                  triggerLabel={`Manage conversion ${conversion.externalRef}`}
                  actions={actionsFor(conversion)}
                  onAction={async (action, reason) => {
                    try {
                      const updated = await changeConversionState(
                        conversion,
                        action as "complete" | "cancel" | "no-show",
                        reason,
                      );
                      await onChanged(updated);
                      onNotice({
                        kind: "success",
                        message: `${updated.externalRef} marked ${updated.status.replaceAll("_", " ")}.`,
                      });
                      return true;
                    } catch (error) {
                      onNotice({
                        kind: "error",
                        message:
                          error instanceof ApiError
                            ? error.message.replaceAll("_", " ")
                            : "Conversion update failed. Try again.",
                      });
                      return false;
                    }
                  }}
                />
              ) : (
                <p className="record-action-unavailable">
                  {["completed", "partially_refunded"].includes(conversion.status)
                    ? "Open Earnings to review refund adjustments."
                    : "No further actions available."}
                </p>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="owner-empty">
          {mode === "refund"
            ? "No refundable conversion records are available."
            : "No conversion records were supplied to this workboard."}
        </p>
      )}
    </section>
  );
}
