import type { Metadata } from "next";

import { PartnerWorkboardPage } from "../../../../features/partner/pages/partner-workboard-page";

export const metadata: Metadata = { title: "Workboard | Northstar Referral Sandbox" };

export default function Page() {
  return <PartnerWorkboardPage />;
}
