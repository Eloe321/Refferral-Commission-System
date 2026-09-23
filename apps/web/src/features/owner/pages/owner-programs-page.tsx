"use client";

import { WorkbenchPageHeading } from "../../../components/workbench-page-heading";
import { ConversionControls } from "../conversion-controls";
import { OwnerNotices, useOwnerWorkspace } from "../owner-workspace-provider";
import { ProgramRules } from "../program-rules";

export function OwnerProgramsPage() {
  const { overview, conversions, refresh, replaceConversion, setNotice } = useOwnerWorkspace();
  return (
    <div className="route-page">
      <WorkbenchPageHeading
        eyebrow="Rule desk"
        title="Programs and attribution"
        description="Control which referrals enter the program and how completed work resolves into commission."
      />
      <OwnerNotices />
      <ProgramRules programs={overview.programs} partners={overview.partners} onChanged={refresh} onNotice={setNotice} />
      <ConversionControls
        mode="lifecycle"
        conversions={conversions}
        onChanged={async (updated) => {
          replaceConversion(updated);
          await refresh();
        }}
        onNotice={setNotice}
      />
    </div>
  );
}
