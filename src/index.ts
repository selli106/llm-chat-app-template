/**
 * LLM Chat Application Template
 * Enhanced with email parsing for task extraction and .ics generation + email sending.
 *
 * @license MIT
 */
import { Env, ChatMessage, ForwardableEmailMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
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

// Fixed attendees list (all optional)
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
      // Serve static assets or fallback
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

      // Compose prompt for AI extraction
      const prompt = `${SYSTEM_PROMPT}\n\nEmail text:\n${rawBody}`;

      // Call AI model to extract events
      const aiResponse = await env.AI.run(MODEL_ID, { prompt });
      const aiJson = await aiResponse.text();

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

      // Generate ICS content from extracted events
      const icsContent = generateICS(events);

      // Send email with ICS file attached
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


// --- Helpers ---

async function streamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  // Concatenate all chunks
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(result);
}

function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

// Generate a unique ID for the UID field
function generateUID(): string {
  return `${crypto.randomUUID()}@hutchins.tas.edu.au`;
}

function formatDateTimeToICS(dateString: string): string {
  // Convert ISO date string to UTC format: YYYYMMDDTHHmmssZ
  const date = new Date(dateString);
  const pad = (num: number) => num.toString().padStart(2, "0");
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

function generateICS(events: any[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hutchins LLM Chat Worker//EN",
    "CALSCALE:GREGORIAN",
    // Per your instructions, do NOT include METHOD here (some calendars prefer no METHOD)
    // "METHOD:PUBLISH",
  ];

  for (const event of events) {
    const uid = generateUID();

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${formatDateTimeToICS(new Date().toISOString())}`);

    if (event.start) lines.push(`DTSTART:${formatDateTimeToICS(event.start)}`);
    if (event.end) lines.push(`DTEND:${formatDateTimeToICS(event.end)}`);

    if (event.location) {
      lines.push(`LOCATION:${escapeICSText(event.location)}`);
    } else {
      lines.push(`LOCATION:`);
    }

    // Build description from requested fields, some might be missing
    const descriptionParts = [
      `AV Support request location: ${event["AV Support request location:"] || ""}`,
      `AV Support requirements: ${event["AV Support requirements:"] || ""}`,
      `Brief description: ${event["Brief description:"] || ""}`,
      `Other: ${event["Other:"] || ""}`,
      `Description: ${event.description || ""}`,
    ];

    const description = escapeICSText(descriptionParts.join("\n"));
    lines.push(`DESCRIPTION:${description}`);

    lines.push(`SUMMARY:${escapeICSText(event.title || "No Title")}`);

    // Attendees - all optional participants, combine event attendees + fixed attendees
    const attendeesSet = new Map<string, string>(); // email -> name

    if (Array.isArray(event.attendees)) {
      for (const att of event.attendees) {
        if (att.email && att.name) {
          attendeesSet.set(att.email, att.name);
        }
      }
    }
    // Add fixed attendees (optional)
    for (const att of ATTENDEES) {
      attendeesSet.set(att.email, att.name);
    }

    for (const [email, name] of attendeesSet.entries()) {
      lines.push(
        `ATTENDEE;CN=${escapeICSText(name)};RSVP=FALSE;PARTSTAT=NEEDS-ACTION;CUTYPE=INDIVIDUAL:mailto:${email}`,
      );
    }

    // Reminder 30 minutes before event
    lines.push("BEGIN:VALARM");
    lines.push("TRIGGER:-PT30M");
    lines.push("DESCRIPTION:Reminder");
    lines.push("ACTION:DISPLAY");
    lines.push("END:VALARM");

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.join("\r\n");
}

async function sendEmailWithICS(env: Env, options: {
  to: string;
  subject: string;
  body: string;
  ics: string;
}): Promise<void> {
  if (!env.MAIL || !env.MAIL.send) {
    console.error("Email binding MAIL or send method is not configured.");
    return;
  }

  const boundary = `----boundary_${crypto.randomUUID()}`;
  const message = [
    `To: ${options.to}`,
    `Subject: ${options.subject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 7bit",
    "",
    options.body,
    "",
    `--${boundary}`,
    'Content-Type: text/calendar; method=PUBLISH; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    'Content-Disposition: attachment; filename="invite.ics"',
    "",
    options.ics,
    "",
    `--${boundary}--`,
  ].join("\r\n");

  try {
    await env.MAIL.send({
      to: options.to,
      subject: options.subject,
      raw: message,
    });
  } catch (e) {
    console.error("❌ Failed to send email with ICS:", e);
  }
}

// Stub for chat request handler - can be extended or replaced as needed
async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  try {
    const json = await request.json();
    const messages: ChatMessage[] = json.messages || [];

    // Compose prompt with system + user messages for AI
    const promptMessages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages,
    ];

    // For simplicity, flatten messages to text prompt (or adapt to model API)
    // This depends on your AI API contract, here assumed raw prompt string
    const combinedPrompt = promptMessages
      .map((m) => (m.role === "system" ? `[System]: ${m.content}` : `[User]: ${m.content}`))
      .join("\n");

    const aiResponse = await env.AI.run(MODEL_ID, { prompt: combinedPrompt });
    const text = await aiResponse.text();

    return new Response(text, {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("❌ Error in chat handler:", e);
    return new Response("Internal Server Error", { status: 500 });
  }
}
