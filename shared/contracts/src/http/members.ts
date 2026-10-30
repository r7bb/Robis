import { z } from 'zod';
import { ROLES } from '../rbac.ts';
import { inviteMemberSchema, setMemberRoleSchema, uuid } from '../schemas.ts';
import { avatar, workspaceParams } from './common.ts';
import { contract, timestamp } from './contract.ts';

const role = z.enum(ROLES);

/** The member's id stays a plain string: an unknown one is a 404, not a 400. */
const memberParams = workspaceParams.extend({ userId: z.string() });
const invitationParams = z.object({ invitationId: z.string() });

/** Someone in a workspace. Only those who may invite see addresses. */
const member = z.object({
  userId: uuid,
  email: z.string().nullable(),
  name: z.string(),
  username: z.string(),
  role,
  joinedAt: timestamp,
  avatar,
});

/** An invitation as the workspace that sent it sees it. */
const sentInvitation = z.object({
  id: uuid,
  /** Null for one sent to an address: who that turned out to be is never shown. */
  userId: uuid.nullable(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  username: z.string().nullable(),
  role,
  createdAt: timestamp,
});

export const memberContracts = {
  'members.list': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/members',
    summary: "A workspace's members, in the order they joined.",
    params: workspaceParams,
    response: z.object({ members: z.array(member) }),
  }),
  'members.invite': contract({
    method: 'POST',
    path: '/workspaces/:workspaceId/members',
    summary:
      'Invite someone by username (201, the invitation) or by address (202, sent whether or not it has an account).',
    params: workspaceParams,
    body: inviteMemberSchema,
    status: [201, 202],
    response: z.object({
      invitation: z.union([
        sentInvitation.extend({ userId: uuid, name: z.string(), username: z.string() }),
        z.object({ email: z.string(), role, status: z.literal('sent') }),
      ]),
    }),
  }),
  'members.setRole': contract({
    method: 'PATCH',
    path: '/workspaces/:workspaceId/members/:userId',
    summary: "Change a member's role, within your own authority.",
    params: memberParams,
    body: setMemberRoleSchema,
    response: z.object({ member: z.object({ userId: z.string(), role }) }),
  }),
  'members.remove': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/members/:userId',
    summary: 'Remove a member, within your own authority.',
    params: memberParams,
    status: 204,
    response: null,
  }),
  'members.leave': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/members/me',
    summary: 'Leave a workspace; the last owner cannot.',
    params: workspaceParams,
    status: 204,
    response: null,
  }),
  'invitations.sent': contract({
    method: 'GET',
    path: '/workspaces/:workspaceId/invitations',
    summary: 'Invitations from a workspace that have not been answered.',
    params: workspaceParams,
    response: z.object({ invitations: z.array(sentInvitation) }),
  }),
  'invitations.withdraw': contract({
    method: 'DELETE',
    path: '/workspaces/:workspaceId/invitations/:invitationId',
    summary: 'Withdraw an invitation that has not been answered.',
    params: workspaceParams.extend({ invitationId: z.string() }),
    status: 204,
    response: null,
  }),
  'invitations.mine': contract({
    method: 'GET',
    path: '/invitations',
    summary: 'The invitations waiting for you, from any workspace.',
    response: z.object({
      invitations: z.array(
        z.object({
          id: uuid,
          role,
          createdAt: timestamp,
          workspace: z.object({ id: uuid, name: z.string() }),
          /** The inviter's username, or null if their account is gone. */
          invitedBy: z.string().nullable(),
        }),
      ),
    }),
  }),
  'invitations.accept': contract({
    method: 'POST',
    path: '/invitations/:invitationId/accept',
    summary: 'Join the workspace an invitation is for.',
    params: invitationParams,
    response: z.object({ workspace: z.object({ id: uuid, name: z.string() }), role }),
  }),
  'invitations.decline': contract({
    method: 'POST',
    path: '/invitations/:invitationId/decline',
    summary: 'Turn an invitation down.',
    params: invitationParams,
    status: 204,
    response: null,
  }),
} as const;
