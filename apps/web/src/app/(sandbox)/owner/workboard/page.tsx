import type { Metadata } from "next";

import { OwnerWorkboardPage } from "../../../../features/owner/pages/owner-workboard-page";

export const metadata: Metadata = { title: "Workboard | Northstar Referral Sandbox" };

export default function Page() {
  return <OwnerWorkboardPage />;
}
