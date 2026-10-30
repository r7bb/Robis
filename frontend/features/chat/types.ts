import type { contracts, ResponseOf } from '@robis/shared';

/** Chat as the API's contracts describe it (`shared/contracts/src/http/channels.ts`). */

export type MessagePage = ResponseOf<(typeof contracts)['messages.list']>;

export type ChannelSummary = ResponseOf<(typeof contracts)['channels.list']>['channels'][number];

export type ChatMessage = MessagePage['messages'][number];
