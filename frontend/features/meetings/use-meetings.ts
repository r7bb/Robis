'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.ts';
import type { Meeting, MeetingResponse, NewMeeting } from './types.ts';

/**
 * Data access for meetings.
 *
 * The query key is shared with `lib/realtime.ts`, which invalidates
 * `['meetings', workspaceId]` whenever a `meeting.changed` event arrives.
 * Exporting the builder rather than spelling the array out in both places
 * means a rename cannot silently stop refreshing one of them.
 */
export function meetingsKey(workspaceId: string, scope: MeetingScope) {
  return ['meetings', workspaceId, scope] as const;
}

export type MeetingScope = 'upcoming' | 'past';

export function useMeetings(workspaceId: string, scope: MeetingScope = 'upcoming') {
  return useQuery({
    queryKey: meetingsKey(workspaceId, scope),
    queryFn: () =>
      api<{ meetings: Meeting[] }>(`/workspaces/${workspaceId}/meetings?scope=${scope}`),
    /*
     * "in 20 minutes" goes stale on its own, with no server change to notice.
     * A slow poll keeps the countdown honest without a socket event for the
     * passage of time; the realtime invalidation handles actual edits.
     */
    refetchInterval: scope === 'upcoming' ? 60_000 : false,
  });
}

/** Both scopes move when anything changes, so they are invalidated together. */
function invalidateAll(workspaceId: string) {
  return { queryKey: ['meetings', workspaceId] as const };
}

export function useScheduleMeeting(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (meeting: NewMeeting) =>
      api<{ meeting: Meeting }>(`/workspaces/${workspaceId}/meetings`, {
        method: 'POST',
        body: meeting,
      }),
    onSuccess: () => queryClient.invalidateQueries(invalidateAll(workspaceId)),
  });
}

export function useRespondToMeeting(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ meetingId, response }: { meetingId: string; response: MeetingResponse }) =>
      api<{ ok: true }>(`/workspaces/${workspaceId}/meetings/${meetingId}/response`, {
        method: 'POST',
        body: { response },
      }),
    onSuccess: () => queryClient.invalidateQueries(invalidateAll(workspaceId)),
  });
}

export function useCancelMeeting(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (meetingId: string) =>
      api<void>(`/workspaces/${workspaceId}/meetings/${meetingId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries(invalidateAll(workspaceId)),
  });
}

/** How many invitees have actually said yes, for the summary line. */
export function countAccepted(meeting: Meeting): number {
  return meeting.attendees.filter((attendee) => attendee.response === 'yes').length;
}

/** The caller's own answer, or null when they were never on the invite list. */
export function responseOf(meeting: Meeting, userId: string | null): MeetingResponse | null {
  if (!userId) return null;

  return meeting.attendees.find((attendee) => attendee.userId === userId)?.response ?? null;
}
