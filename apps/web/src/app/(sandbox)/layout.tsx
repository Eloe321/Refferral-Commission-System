import type { ReactNode } from "react";

import { SandboxWorkspaceProvider } from "../../features/sandbox/sandbox-workspace-provider";

export default function SandboxLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <SandboxWorkspaceProvider>{children}</SandboxWorkspaceProvider>;
}
