'use client';

import { contracts, type ResponseOf } from '@robis/shared';
import { useQuery } from '@tanstack/react-query';
import { call } from '../../lib/api.ts';

export type IssueTemplate = ResponseOf<
  (typeof contracts)['issueTemplates.list']
>['templates'][number];

export const templatesKey = (workspaceId: string) => ['issue-templates', workspaceId] as const;

/** The workspace's issue templates, by name. */
export function useTemplates(workspaceId: string, enabled = true) {
  return useQuery({
    queryKey: templatesKey(workspaceId),
    queryFn: () => call(contracts['issueTemplates.list'], { params: { workspaceId } }),
    enabled,
  });
}

/** The title to start from: one ending in a colon leaves room to carry on. */
export const startingTitle = (title: string) => (/[:\-–]$/.test(title) ? `${title} ` : title);
