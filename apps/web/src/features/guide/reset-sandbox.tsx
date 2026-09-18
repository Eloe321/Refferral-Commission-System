"use client";

import { Button, Sheet } from "@referral-sandbox/ui";
import { RotateCcw } from "lucide-react";
import { useRef, useState } from "react";

export function ResetSandbox({ onReset }: { onReset: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit(): Promise<void> {
    if (confirmation !== "RESET SANDBOX" || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFeedback(null);
    try {
      await onReset();
      setConfirmation("");
      setOpen(false);
      setFeedback("Sandbox reset complete.");
    } catch {
      setOpen(false);
      setFeedback("Reset could not be confirmed. Reload the workbench before continuing.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="reset-control">
      <Sheet
        title="Reset guided sandbox"
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
        trigger={
          <Button variant="quiet">
            <RotateCcw aria-hidden="true" size={16} /> Reset sandbox
          </Button>
        }
      >
        <div className="reset-sheet">
          <p>
            Only fictional local Northstar data is affected. No external messages or payments are
            sent.
          </p>
          <label htmlFor="reset-confirmation">Type RESET SANDBOX to confirm</label>
          <input
            id="reset-confirmation"
            value={confirmation}
            autoComplete="off"
            onChange={(event) => {
              setConfirmation(event.target.value);
            }}
          />
          <Button
            variant="danger"
            disabled={pending || confirmation !== "RESET SANDBOX"}
            onClick={() => void submit()}
          >
            {pending ? "Resetting…" : "Confirm reset"}
          </Button>
        </div>
      </Sheet>
      {feedback ? (
        <p className="reset-feedback" role={feedback.includes("complete") ? "status" : "alert"}>
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
