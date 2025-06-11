/**
 * LLM Chat Application Template
 * Enhanced with email parsing for task extraction and .ics generation + email sending.
 *
 * @license MIT
 */
import { Env, ChatMessage, ForwardableEmailMessage } from "./types";

const MODEL_ID = "@cf/mistral/mistral-small-3.1-24b-instruct";
const SYSTEM_PROMPT = `
You are an AI assistant specialized in extracting event details from emails for calendar scheduling.

From the given email text, identify all tasks, bookings, setup times, and AV support requirements. For each event found, provide a JSON object with these fields:

- title: concise event title
- start: ISO 8601 datetime string for event start
- end: ISO 8601 datetime string for event end
- location: event location (optional)
- description: detailed description of the event
- AV Support request location: string specifying where AV support is needed
- AV Support requirements: string listing required AV equipment or setup
- Brief description: short summary of the event
- Other: any additional notes or information
- attendees: array of objects with 'name' and 'email' for participants (optional)

Return the output as a JSON array of event objects only, no extra explanation or text.

If no events are found, return an empty JSON array: []
`;

// Your fixed attendees list for .ics
const ATTENDEES = [
  { name: "Storm Ellis", email: "storm.ellis@hutchins.tas.edu.au" },
];

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

      // Combine SYSTEM_PROMPT and email text for LLM input
      const prompt = `${SYSTEM_PROMPT}\n\nEmail text:\n${rawBody}`;

      const aiResponse = await env.AI.run(MODEL_ID, {
        prompt,
      });

      const aiJson = await aiResponse.text();

      // Try parsing JSON from the AI's response
      let events;
      try {
        events = JSON.parse(aiJson);
      } catch (e) {
        console.error("❌ Failed to parse AI JSON response:", e, aiJson);
        events = [];
      }

      if (!Array.isArray(events) || events.length === 0) {
        console.log("⚠️ No events extracted from email.");
        return;
      }

      // Generate ICS content for all events
      const icsContent = generateICS(events);

      // Send the .ics file as an email attachment to storm.ellis@hutchins.tas.edu.au
      await sendEmailWithICS(env, {
        to: "storm.ellis@hutchins.tas.edu.au",
        subject: "Extracted AV Events from Email - Calendar Invites",
        body: "Please find attached the calendar events extracted from the email.",
        ics: icsContent,
      });
    } catch (err) {
      console.error("❌ Failed to process email:", err);
    }
  },
} satisfies ExportedHandler<Env>;

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  // concatenate all chunks into a single Uint8Array
  let length = 0;
  for (const chunk of chunks) {
    length += chunk.length;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  // decode Uint8Array to string
  return new TextDecoder().decode(result);
}

// Placeholder: Implement your generateICS function here
function generateICS(events: any[]): string {
  // Your existing generateICS implementation
  return "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR"; // dummy placeholder
}

// Placeholder: Implement your sendEmailWithICS function here
async function sendEmailWithICS(env: Env, options: {
  to: string;
  subject: string;
  body: string;
  ics: string;
}): Promise<void> {
  // Your existing email sending implementation
}
