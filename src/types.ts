/**
 * Type definitions for the LLM chat application.
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
 * Represents an email received by the email() event handler.
 */
export interface ForwardableEmailMessage {
  raw: ReadableStream; // The raw MIME message as a stream
  headers: Record<string, string>; // Lowercase header keys and values
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  date: string;
}
