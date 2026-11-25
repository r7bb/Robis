import type { ReactNode } from 'react';
import { RequireAvatar } from '../../../components/require-avatar.tsx';
import { CommandProvider } from '../../../features/command/command-provider.tsx';
import { SaphaPanelProvider } from '../../../features/sapha/panel/sapha-panel-provider.tsx';

/**
 * Shared by every workspace page: see `RequireAvatar`, the command palette
 * (C2), which opens with Ctrl K or Cmd K on any of them, and Sapha's panel,
 * with Ctrl J or Cmd J.
 */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <SaphaPanelProvider>
      <CommandProvider>
        <RequireAvatar>{children}</RequireAvatar>
      </CommandProvider>
    </SaphaPanelProvider>
  );
}
