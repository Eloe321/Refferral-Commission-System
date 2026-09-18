import type { Metadata } from "next";

import { PartnerEarningsPage } from "../../../../features/partner/pages/partner-earnings-page";

export const metadata: Metadata = { title: "Earnings | Northstar Referral Sandbox" };

export default function Page() {
  return <PartnerEarningsPage />;
}
