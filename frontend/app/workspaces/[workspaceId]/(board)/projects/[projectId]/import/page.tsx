'use client';

import { can } from '@robis/shared';
import { useParams } from 'next/navigation';
import { ImportView } from '../../../../../../../features/imports/import-view.tsx';
import {
  PageFrame,
  useWorkspaceRole,
} from '../../../../../../../features/workspace/page-frame.tsx';

/** Import issues into this board (C6), from a CSV file, a Robis export or GitHub. */
export default function ImportPage() {
  const { workspaceId, role } = useWorkspaceRole();
  const { projectId } = useParams<{ projectId: string }>();
  return (
    <PageFrame
      title="Import issues"
      lead="Bring issues onto this board from a CSV file, a Robis export or GitHub. Running the same import again adds nothing."
    >
      {role && !can(role, 'project:update') ? (
        <p className="text-sm text-muted">Only members who can add issues and labels can import.</p>
      ) : (
        <ImportView workspaceId={workspaceId} projectId={projectId} />
      )}
    </PageFrame>
  );
}
