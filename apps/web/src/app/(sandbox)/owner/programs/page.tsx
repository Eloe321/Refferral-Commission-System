import type { Metadata } from "next";

import { OwnerProgramsPage } from "../../../../features/owner/pages/owner-programs-page";

export const metadata: Metadata = { title: "Programs | Northstar Referral Sandbox" };

export default function Page() {
  return <OwnerProgramsPage />;
}
