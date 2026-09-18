import type { Metadata } from "next";

import { PartnerReferralsPage } from "../../../../features/partner/pages/partner-referrals-page";

export const metadata: Metadata = { title: "Referrals | Northstar Referral Sandbox" };

export default function Page() {
  return <PartnerReferralsPage />;
}
