"use client";

import type { EarningView } from "@referral-sandbox/contracts";

import { ApiError, changeEarningState } from "../../lib/api-client";
import { ActionSheet, type OwnerAction } from "./action-sheet";

export type OperationNotice = { kind: "success" | "error"; message: string };

export type EarningControlsProps = {
  earning: EarningView;
  reference: string;
  onChanged: () => Promise<void>;
  onNotice: (notice: OperationNotice) => void;
};

export function canManageEarning(earning: EarningView): boolean {
  return ["pending", "eligible", "reserved", "held"].includes(earning.status);
}

function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message.replaceAll("_", " ")
    : "The operation could not be completed. Try again.";
}

export function EarningControls({ earning, reference, onChanged, onNotice }: EarningControlsProps) {
  const actions: OwnerAction[] = [];
  if (["pending", "eligible", "reserved"].includes(earning.status))
    actions.push({
      id: "hold",
      label: "Place hold",
      description: "Stop this commission while the business reviews it.",
      reasonRequired: true,
    });
  if (earning.status === "held")
    actions.push({
      id: "release",
      label: "Release hold",
      description: "Return this commission to its previous available state.",
      reasonRequired: true,
    });
  if (!["settled", "reversed", "voided"].includes(earning.status))
    actions.push({
      id: "void",
      label: "Void earning",
      description: "Permanently remove this commission from the claimable queue.",
      reasonRequired: true,
      tone: "danger",
    });

  return (
    <ActionSheet
      title={`Earning ${reference}`}
      triggerLabel={`Manage earning ${reference}`}
      triggerDescription={earning.statusExplanation}
      actions={actions}
      onAction={async (action, reason) => {
        try {
          await changeEarningState(earning.id, action as "hold" | "release" | "void", reason);
          await onChanged();
          onNotice({
            kind: "success",
            message:
              action === "hold"
                ? "Earning placed on hold."
                : action === "release"
                  ? "Earning hold released."
                  : "Earning voided.",
          });
          return true;
        } catch (error) {
          onNotice({ kind: "error", message: errorMessage(error) });
          return false;
        }
      }}
    />
  );
}
