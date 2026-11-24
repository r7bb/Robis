'use client';

import { can } from '@robis/shared';
import { GitHubPanel } from '../../../../../features/automations/github-panel.tsx';
import { RulesView } from '../../../../../features/automations/rules-view.tsx';
import { WebhooksPanel } from '../../../../../features/automations/webhooks-panel.tsx';
import { PageFrame, useWorkspaceRole } from '../../../../../features/workspace/page-frame.tsx';

/** Automation rules (B9) and outgoing webhooks (C7), for administrators. */
export default function AutomationsPage() {
  const { workspaceId, role } = useWorkspaceRole();
  return (
    <PageFrame
      title="Automations"
      lead="Rules that do one thing when something happens to an issue, and webhooks that tell another system, and GitHub pull requests on issues."
    >
      {role && !can(role, 'automation:manage') ? (
        <p className="text-sm text-muted">Only administrators manage automations.</p>
      ) : (
        <div className="space-y-12">
          <RulesView workspaceId={workspaceId} />
          {role && can(role, 'webhook:manage') ? (
            <>
              <WebhooksPanel workspaceId={workspaceId} />
              <GitHubPanel workspaceId={workspaceId} />
            </>
          ) : null}
        </div>
      )}
    </PageFrame>
  );
}
