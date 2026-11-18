import type { ReactNode } from 'react';
import { RequireAvatar } from '../../../components/require-avatar.tsx';
import { CommandProvider } from '../../../features/command/command-provider.tsx';

/**
 * Shared by every workspace page: see `RequireAvatar`, and the command
 * palette (C2), which opens with Ctrl K or Cmd K on any of them.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <CommandProvider>
      <RequireAvatar>{children}</RequireAvatar>
    </CommandProvider>
  );
}
