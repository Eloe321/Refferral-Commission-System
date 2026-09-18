import type { Metadata } from "next";

import { OwnerEarningsPage } from "../../../../features/owner/pages/owner-earnings-page";

export const metadata: Metadata = { title: "Earnings | Northstar Referral Sandbox" };

export default function Page() {
  return <OwnerEarningsPage />;
}
