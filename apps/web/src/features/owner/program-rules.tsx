"use client";

import type { Program } from "@referral-sandbox/contracts";
import { Money, StatusBadge } from "@referral-sandbox/ui";

import { ApiError, changeProgramState } from "../../lib/api-client";
import { ActionSheet } from "./action-sheet";
import type { OperationNotice } from "./earning-controls";

export type ProgramRulesProps = {
  programs: Program[];
  onChanged: () => Promise<void>;
  onNotice: (notice: OperationNotice) => void;
};

export function ProgramRules({ programs, onChanged, onNotice }: ProgramRulesProps) {
  return (
    <section id="programs" className="owner-panel" aria-labelledby="programs-title">
      <div className="owner-panel__heading">
        <div>
          <p className="eyebrow">Rule desk</p>
          <h2 id="programs-title">Programs and rule priority</h2>
        </div>
        <p>A specific partner rule wins first; a category rule wins before the program fallback.</p>
      </div>
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
