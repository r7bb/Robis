'use client';

import { can } from '@robis/shared';
import { RulesView } from '../../../../../features/automations/rules-view.tsx';
import { PageFrame, useWorkspaceRole } from '../../../../../features/workspace/page-frame.tsx';

/** Automation rules (B9), for administrators. */
export default function AutomationsPage() {
  const { workspaceId, role } = useWorkspaceRole();
  return (
    <PageFrame
      title="Automations"
      lead="Rules that do one thing when something happens to an issue."
    >
      {role && !can(role, 'automation:manage') ? (
        <p className="text-sm text-muted">Only administrators manage automations.</p>
      ) : (
        <RulesView workspaceId={workspaceId} />
      )}
    </PageFrame>
  );
}
