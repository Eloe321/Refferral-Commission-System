import type { Metadata } from "next";

import { PartnerClaimsPage } from "../../../../features/partner/pages/partner-claims-page";

export const metadata: Metadata = { title: "Claims | Northstar Referral Sandbox" };

export default function Page() {
  return <PartnerClaimsPage />;
}
