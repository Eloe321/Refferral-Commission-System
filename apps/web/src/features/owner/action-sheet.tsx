"use client";

import { Button, Sheet } from "@referral-sandbox/ui";
import { useId, useRef, useState } from "react";

export type OwnerAction = {
  id: string;
  label: string;
  description: string;
  tone?: "primary" | "secondary" | "danger";
  reasonRequired?: boolean;
};

export type ActionSheetProps = {
  title: string;
  triggerLabel: string;
  triggerDescription?: string;
  actions: OwnerAction[];
  onAction: (action: string, reason: string) => Promise<boolean>;
};

export function ActionSheet({
  title,
  triggerLabel,
  triggerDescription,
  actions,
  onAction,
}: ActionSheetProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pendingGuard = useRef(false);
  const reasonId = useId();
  const needsReason = actions.some((action) => action.reasonRequired);

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen && pendingAction === null) setReason("");
  }

  async function run(action: OwnerAction) {
    if (pendingGuard.current) return;
    pendingGuard.current = true;
    setPendingAction(action.id);
    try {
      const succeeded = await onAction(action.id, reason);
      if (succeeded) {
        setOpen(false);
        setReason("");
      } else {
        setOpen(false);
      }
    } finally {
      pendingGuard.current = false;
      setPendingAction(null);
    }
  }

  return (
    <Sheet
      title={title}
      open={open}
      onOpenChange={changeOpen}
      trigger={
        <Button variant="secondary" aria-label={triggerLabel}>
          Manage
        </Button>
      }
    >
      {triggerDescription ? <p className="action-sheet__intro">{triggerDescription}</p> : null}
      {needsReason ? (
        <label className="action-sheet__reason" htmlFor={reasonId}>
          Reason
          <textarea
            id={reasonId}
            aria-label="Reason"
            rows={4}
            minLength={3}
            maxLength={240}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <span>Recorded with the operation for later review.</span>
        </label>
      ) : null}
      <div className="action-sheet__options">
        {actions.map((action) => (
          <div className="action-sheet__option" key={action.id}>
            <div>
              <strong>{action.label}</strong>
              <p>{action.description}</p>
            </div>
            <Button
              aria-label={action.label}
              variant={action.tone === "danger" ? "danger" : "primary"}
              disabled={
                pendingAction === action.id ||
                (action.reasonRequired === true && reason.trim().length < 3)
              }
              onClick={() => {
                void run(action);
              }}
            >
              {pendingAction === action.id ? `${action.label}…` : action.label}
            </Button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
