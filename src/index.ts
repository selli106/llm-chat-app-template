/**
 * LLM Chat Application Template
 * Enhanced with email parsing for task extraction and .ics generation + email sending.
 *
 * @license MIT
 */
import { Env, ChatMessage, ForwardableEmailMessage } from "./types";

const MODEL_ID = "@cf/mistral/mistral-small-3.1-24b-instruct";
const SYSTEM_PROMPT =
  "You are a helpful, friendly assistant. Provide concise and accurate responses.";

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

      // Prompt LLM to extract structured events/tasks from email
      const prompt = `Extract all tasks, bookings, setup times, and AV support needs from this email. 
Format your response as a JSON array of events. Each event must have:
- title (string)
- start (ISO datetime string)
- end (ISO datetime string)
- location (string, optional)
- description (string)
- AV Support request location: (string)
- AV Support requirements: (string)
- Brief description: (string)
- Other: (string)
- attendees: array of {name, email} (optional)

Example:
[
  {
    "title": "Soundcheck for students",
    "start": "2025-06-30T08:00:00+10:00",
    "end": "2025-06-30T12:00:00+10:00",
    "location": "Auditorium",
    "description": "Soundcheck session for mid year performances.",
    "AV Support request location:": "Auditorium",
    "AV Support requirements:": "Lectern microphone, stage lighting",
    "Brief description:": "Soundcheck for students",
    "Other:": "",
    "attendees": [
      {"name": "Matt Magnus", "email": "mmg@hutchins.tas.edu.au"}
    ]
  }
]

Now extract from this email text:

${rawBody}
`;

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

// ... (rest of the unchanged helper functions remain the same)
