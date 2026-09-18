import type { Claim, LedgerEntry } from "@referral-sandbox/contracts";
import { Money, StatusBadge } from "@referral-sandbox/ui";

export type ClaimHistoryProps = {
  claims: Claim[];
  ledgerEntries: LedgerEntry[];
};

function shortId(id: string): string {
  return id.slice(0, 8);
}

export function ClaimHistory({ claims, ledgerEntries }: ClaimHistoryProps) {
  return (
    <section id="claims" className="partner-panel" aria-labelledby="partner-history-title">
      <div className="partner-panel__heading">
        <div>
          <p className="eyebrow">Settlement tape</p>
          <h2 id="partner-history-title">Claims and adjustments</h2>
        </div>
        <p>
          Claims above come from the API. Ledger entries are supplied snapshots until a public
          ledger route is available.
        </p>
      </div>

      {claims.length ? (
        <div className="partner-history-list">
          {claims.map((claim) => (
            <article
              className="partner-history-record"
              aria-label={`Claim ${shortId(claim.id)}`}
              key={claim.id}
            >
              <div className="partner-history-record__heading">
                <span className="data-id">Claim {shortId(claim.id)}</span>
                {claim.status === "failed" ? (
                  <StatusBadge status={claim.status} label="Payout failed" />
                ) : (
                  <StatusBadge status={claim.status} />
                )}
              </div>
              <Money {...claim.amount} />
              <time dateTime={claim.updatedAt}>{new Date(claim.updatedAt).toLocaleString()}</time>
              <ul aria-label={`Claim ${shortId(claim.id)} items`}>
                {claim.items.map((item) => (
                  <li key={item.id}>
                    <code>{item.earningId}</code>
                    <Money {...item.amount} />
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      ) : (
        <p className="owner-empty">No server claims yet. Eligible earnings can start one below.</p>
      )}

      {ledgerEntries.length ? (
        <div className="partner-ledger-list" aria-label="Supplied ledger activity">
          {ledgerEntries.map((entry) => (
            <article
              className="partner-history-record partner-history-record--ledger"
              aria-label={`${entry.entryType} ${shortId(entry.id)}`}
              key={entry.id}
            >
              <div className="partner-history-record__heading">
                <strong>{entry.entryType === "reversal" ? "Reversal" : "Ledger adjustment"}</strong>
                <span className="partner-provenance">Supplied ledger record</span>
              </div>
              <Money {...entry.amount} />
              {entry.reason ? <p>{entry.reason}</p> : null}
              <dl>
                <div>
                  <dt>Ledger ID</dt>
                  <dd>{entry.id}</dd>
                </div>
                {entry.claimId ? (
                  <div>
                    <dt>Claim ID</dt>
                    <dd>{entry.claimId}</dd>
                  </div>
                ) : null}
              </dl>
              <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString()}</time>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
