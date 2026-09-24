import type { Metadata } from "next";

import { OwnerBookingsPage } from "../../../../features/owner/pages/owner-bookings-page";

export const metadata: Metadata = { title: "Bookings | Northstar Referral Sandbox" };

export default function Page() {
  return <OwnerBookingsPage />;
}
