import type { ReactNode } from "react";

import { OwnerWorkspaceProvider } from "../../../features/owner/owner-workspace-provider";

export default function OwnerLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <OwnerWorkspaceProvider>{children}</OwnerWorkspaceProvider>;
}
