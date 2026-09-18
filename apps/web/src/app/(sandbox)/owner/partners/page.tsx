import type { Metadata } from "next";

import { OwnerPartnersPage } from "../../../../features/owner/pages/owner-partners-page";

export const metadata: Metadata = { title: "Partners | Northstar Referral Sandbox" };

export default function Page() {
  return <OwnerPartnersPage />;
}
