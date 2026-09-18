"use client";

import type { PreviewSms } from "@referral-sandbox/contracts";
import { Button, Sheet } from "@referral-sandbox/ui";
import { Copy, MessageSquareText } from "lucide-react";
import { useEffect, useState } from "react";

export type SmsPreviewDrawerProps = {
  open: boolean;
  preview: PreviewSms;
  serverNowMs: number;
  receivedAtClientMs: number;
  onOpenChange: (open: boolean) => void;
  onCopied: () => void;
  focusAfterClose?: () => void;
};

function expiryLabel(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function SmsPreviewDrawer({
  open,
  preview,
  serverNowMs,
  receivedAtClientMs,
  onOpenChange,
  onCopied,
  focusAfterClose,
}: SmsPreviewDrawerProps) {
  const [now, setNow] = useState(() => Date.now());
  const [copyError, setCopyError] = useState<string | null>(null);
  const serverRelativeNow = serverNowMs + Math.max(0, now - receivedAtClientMs);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [open]);

  async function copyCode() {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(preview.code);
      onCopied();
    } catch {
      setCopyError("Copy unavailable. Enter the code manually.");
    }
  }

  return (
    <Sheet
      title="SMS preview"
      open={open}
      onOpenChange={onOpenChange}
      onCloseAutoFocus={(event) => {
        if (!focusAfterClose) return;
        event.preventDefault();
        focusAfterClose();
      }}
      className="sms-preview-sheet"
    >
      <div className="sms-preview-proof">
        <MessageSquareText aria-hidden="true" size={20} />
        <strong>Local preview — no SMS was sent.</strong>
      </div>
      <dl className="sms-preview-meta">
        <div>
          <dt>Fictional recipient</dt>
          <dd>{preview.recipientMasked}</dd>
        </div>
        <div>
          <dt>Expires in</dt>
          <dd>{expiryLabel(preview.expiresAt, serverRelativeNow)}</dd>
        </div>
      </dl>
      <div className="sms-device" aria-label="Preview message">
        <p>{preview.message}</p>
        <data value={preview.code}>{preview.code}</data>
      </div>
      <Button onClick={() => void copyCode()}>
        <Copy aria-hidden="true" size={17} /> Copy code
      </Button>
      {copyError ? (
        <p className="partner-notice partner-notice--error" role="alert">
          {copyError}
        </p>
      ) : null}
    </Sheet>
  );
}
