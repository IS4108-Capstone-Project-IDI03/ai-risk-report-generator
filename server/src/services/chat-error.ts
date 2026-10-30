// An error the chat routes answer with its own status and message (CB-03, CB-05): 404 for a chat
// or fact that is missing or not the user's, 400 for bad input, 409 for a full list. Thrown by
// chat-conversation.service.ts and chat-memory.service.ts; answered by routes/chat.routes.ts.
export class ChatError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
