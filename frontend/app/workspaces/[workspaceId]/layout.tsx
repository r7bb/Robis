import type { ReactNode } from 'react';
import { RequireAvatar } from '../../../components/require-avatar.tsx';

/** Shared by every workspace page: see `RequireAvatar`. */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <RequireAvatar>{children}</RequireAvatar>;
}
