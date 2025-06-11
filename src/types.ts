/**
 * Type definitions for the LLM chat and email processing application.
 */

export interface Env {
  /**
   * Binding for the Workers AI API.
   */
  AI: Ai;

  /**
   * Binding for static assets.
   */
  ASSETS: { fetch: (request: Request) => Promise<Response> };
}

/**
 * Represents a chat message.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Represents an email message that can be forwarded to a Worker.
 */
export interface ForwardableEmailMessage {
  /**
   * Raw email body stream (RFC 822 format).
   */
  raw: ReadableStream;

  /**
   * Simplified email headers.
   */
  headers: Record<string, string>;
}
