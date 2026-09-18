"use client";

import { Button } from "@referral-sandbox/ui";
import { Copy } from "lucide-react";
import { useState } from "react";
import QRCode from "react-qr-code";

export type PublicReferral = {
  code: string;
  publicUrl: string;
};

function safePublicUrl(referral: PublicReferral): string | null {
  if (!/^[A-Za-z0-9_-]{4,32}$/.test(referral.code)) return null;
  try {
    const url = new URL(referral.publicUrl);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "referrals.example.invalid" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.pathname !== `/r/${encodeURIComponent(referral.code)}`
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function ReferralCodeCard({ referral }: { referral: PublicReferral }) {
  const [notice, setNotice] = useState<string | null>(null);
  const publicUrl = safePublicUrl(referral);

  async function copy() {
    if (!publicUrl) return;
    try {
      await navigator.clipboard.writeText(publicUrl);
      setNotice("Referral link copied");
    } catch {
      setNotice("Copy unavailable. Select the referral link instead.");
    }
  }

  return (
    <section
      id="referrals"
      className="partner-panel referral-ticket"
      aria-labelledby="referral-code-title"
    >
      <div>
        <p className="eyebrow">Public referral pass</p>
        <h2 id="referral-code-title">Share {referral.code}</h2>
        <p>
          This fictional public link contains no contact details, account session, or private
          business data.
        </p>
      </div>
      {publicUrl ? (
        <>
          <div className="referral-ticket__qr" data-qr-value={publicUrl}>
            <QRCode
              role="img"
              aria-label={`QR code for referral ${referral.code}`}
              value={publicUrl}
              size={136}
              bgColor="#ffffff"
              fgColor="#0d1f2d"
            />
          </div>
          <code>{publicUrl}</code>
          <Button variant="secondary" aria-label="Copy referral link" onClick={() => void copy()}>
            <Copy aria-hidden="true" size={17} /> Copy referral link
          </Button>
        </>
      ) : (
        <p className="partner-notice partner-notice--error" role="alert">
          The public referral link is unavailable. Use a fictional referral URL without private
          data.
        </p>
      )}
      {notice ? (
        <p className="partner-notice" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
