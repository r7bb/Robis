'use client';

import { can } from '@robis/shared';
import { useParams } from 'next/navigation';
import { ImportView } from '../../../../../../../features/imports/import-view.tsx';
import {
  PageFrame,
  useWorkspaceRole,
} from '../../../../../../../features/workspace/page-frame.tsx';

/** Import issues into this board (C6), from a CSV file or a Robis export. */
export default function ImportPage() {
  const { workspaceId, role } = useWorkspaceRole();
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <PageFrame
      title="Import issues"
      lead="Bring issues onto this board from a CSV file or a Robis export. Running the same import again adds nothing."
    >
      {role && !can(role, 'issue:create') ? (
        <p className="text-sm text-muted">Only members who can add issues can import them.</p>
      ) : (
        <ImportView workspaceId={workspaceId} projectId={projectId} />
      )}
    </PageFrame>
  );
}
