import type { ReactNode } from "react";

import { PartnerWorkspaceProvider } from "../../../features/partner/partner-workspace-provider";

export default function PartnerLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <PartnerWorkspaceProvider>{children}</PartnerWorkspaceProvider>;
}
