/**
 * LLM Chat Application Template
 * Enhanced with email parsing for task extraction.
 *
 * @license MIT
 */
import { Env, ChatMessage, ForwardableEmailMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. Provide concise and accurate responses.";

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === "/api/chat") {
      if (request.method === "POST") {
        return handleChatRequest(request, env);
      }

      return new Response("Method not allowed", { status: 405 });
    }

    return new Response("Not found", { status: 404 });
  },

  async email(
    message: ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    try {
      const rawBody = await streamToString(message.raw);

      const prompt = `Extract all tasks, bookings, setup times, and AV support needs from this email:\n\n${rawBody}`;

      const aiResponse = await env.AI.run(MODEL_ID, {
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant extracting structured task data from AV-related emails.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 1024,
      });

      const result = await aiResponse.json();
      console.log("📬 Parsed Email Output:", result);

      // Optional: send to webhook, KV, or re-email
    } catch (err) {
      console.error("❌ Failed to process email:", err);
    }
  },
} satisfies ExportedHandler<Env>;

async function handleChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const { messages = [] } = (await request.json()) as {
      messages: ChatMessage[];
    };

    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    const response = await env.AI.run(
      MODEL_ID,
      {
        messages,
        max_tokens: 1024,
      },
      {
        returnRawResponse: true,
      },
    );

    return response;
  } catch (error) {
    console.error("Error processing chat request:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process request" }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
}

// Helper: Convert ReadableStream to string
async function streamToString(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}
