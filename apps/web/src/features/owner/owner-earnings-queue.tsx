"use client";

import type { EarningView } from "@referral-sandbox/contracts";

import { EarningCard } from "../../components/earning-card";
import { canManageEarning, EarningControls, type OperationNotice } from "./earning-controls";

export function OwnerEarningsQueue({
  earnings,
  referenceByItem,
  onChanged,
  onNotice,
}: {
  earnings: EarningView[];
  referenceByItem: ReadonlyMap<string, string>;
  onChanged: () => Promise<void>;
  onNotice: (notice: OperationNotice) => void;
}) {
  return (
    <section className="owner-panel" aria-labelledby="earnings-title">
      <div className="owner-panel__heading">
        <div>
          <p className="eyebrow">Commission queue</p>
          <h2 id="earnings-title">Earnings</h2>
        </div>
        <p>Each row becomes a labeled work card on phones while keeping table semantics.</p>
      </div>
      <div className="earning-table-wrap">
        <table className="earning-table" aria-label="Earnings work queue">
          <thead>
            <tr>
              <th scope="col">Work item</th>
              <th scope="col">Status</th>
              <th scope="col">Commission</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {earnings.map((earning) => {
              const reference =
                referenceByItem.get(earning.conversionItemId) ?? earning.id.slice(0, 8);
              return (
                <EarningCard
                  key={earning.id}
                  earning={earning}
                  reference={reference}
                  action={
                    canManageEarning(earning) ? (
                      <EarningControls
                        earning={earning}
                        reference={reference}
                        onChanged={onChanged}
                        onNotice={onNotice}
                      />
                    ) : (
                      <span className="record-action-unavailable">No action available</span>
                    )
                  }
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
