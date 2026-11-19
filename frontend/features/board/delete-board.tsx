'use client';

import { can, contracts, type Role } from '@robis/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { DeleteButton } from '../../components/delete-button.tsx';
import { call } from '../../lib/api.ts';

/**
 * Delete the board on show, beside its name, for those who may: it lived
 * in the old right-hand panel's project list. Afterwards the workspace
 * opens on another board, or says there are none.
 */
export function DeleteBoard({
  workspaceId,
  projectId,
  name,
  role,
}: {
  workspaceId: string;
  projectId: string;
  name: string;
  role: Role | undefined;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const remove = useMutation({
    mutationFn: () => call(contracts['projects.delete'], { params: { workspaceId, projectId } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['projects', workspaceId] });
      router.replace(`/workspaces/${workspaceId}`);
    },
  });

  return (
    <DeleteButton
      allowed={role !== undefined && can(role, 'project:delete')}
      kind="board"
      name={name}
      cascade="Every issue and comment on this board is deleted with it."
      onConfirm={() => remove.mutateAsync()}
    />
  );
}
