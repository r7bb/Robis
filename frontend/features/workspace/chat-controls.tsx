'use client';

import { createContext, type ReactNode, useContext } from 'react';

/**
 * What the middle of the frame can ask of the chat beside it: start a
 * message about something (Discuss), or show a room. Null outside the
 * frame, as on an issue's own page, where there is no chat to ask.
 */
export type ChatControls = {
  /** Open the chat with this in the message box, ready to finish and send. */
  discuss: (text: string) => void;
  /** Open the chat on this room. */
  openRoom: (channelId: string) => void;
};

const ChatControlsContext = createContext<ChatControls | null>(null);

export function ChatControlsProvider({
  value,
  children,
}: {
  value: ChatControls;
  children: ReactNode;
}) {
  return <ChatControlsContext.Provider value={value}>{children}</ChatControlsContext.Provider>;
}

export function useChatControls(): ChatControls | null {
  return useContext(ChatControlsContext);
}

/** Text put in the message box from elsewhere; `at` tells one ask from the next. */
export type ChatDraft = { text: string; at: number };
