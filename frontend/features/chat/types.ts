/** Wire shapes for chat, mirroring what `routes/channels.ts` returns. */

export type ChannelSummary = {
  id: string;
  name: string;
  topic: string | null;
  createdAt: string;
};

export type ChatMessage = {
  id: string;
  channelId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  authorId: string;
  authorName: string;
};

export type MessagePage = {
  messages: ChatMessage[];
  nextCursor: string | null;
};
