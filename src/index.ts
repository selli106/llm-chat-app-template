/**
 * LLM Chat Application Template
 * Enhanced with email parsing for task extraction and .ics generation + email sending.
 *
 * @license MIT
 */
import { Env, ChatMessage, ForwardableEmailMessage } from "./types";

const MODEL_ID = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
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
        max_tokens: 1500,
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

/**
 * Generate a full .ics calendar file content string from an array of event objects.
 * Applies all your rules for .ics formatting:
 * - Each attendee marked as optional participant
 * - All required description sections present
 * - VTIMEZONE for Tasmania included
 * - UID unique per event
 * - VALARM 30 minutes prior reminder
 * - Proper escaping and formatting
 */
function generateICS(events: any[]): string {
  const dtstamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  // Tasmania timezone VTIMEZONE block for Australia/Hobart (AEST/AEDT)
  const timezoneBlock = `BEGIN:VTIMEZONE
TZID:Australia/Hobart
X-LIC-LOCATION:Australia/Hobart
BEGIN:STANDARD
TZOFFSETFROM:+1100
TZOFFSETTO:+1000
TZNAME:AEST
DTSTART:19700405T030000
RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU
END:STANDARD
BEGIN:DAYLIGHT
TZOFFSETFROM:+1000
TZOFFSETTO:+1100
TZNAME:AEDT
DTSTART:19701004T020000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU
END:DAYLIGHT
END:VTIMEZONE`;

  const icsEvents = events
    .map((event, index) => {
      const uid = `event-${Date.now()}-${index}@streamlink.stream`;

      // Format dates in ICS format with timezone
      const dtstart = formatDateTimeICS(event.start);
      const dtend = formatDateTimeICS(event.end);

      // Build description including all required fields with line breaks escaped as \n
      const descLines = [
        `AV Support request location: ${escapeICSText(event["AV Support request location:"] || event.location || "")}`,
        `AV Support requirements: ${escapeICSText(event["AV Support requirements:"] || "")}`,
        `Brief description: ${escapeICSText(event["Brief description:"] || event.description || event.title || "")}`,
        `Other: ${escapeICSText(event["Other:"] || "")}`,
      ];
      const description = descLines.join("\\n");

      // Attendees from event or fallback to fixed ATTENDEES, all optional
      let attendeesStr = "";
      if (Array.isArray(event.attendees) && event.attendees.length > 0) {
        attendeesStr = event.attendees
          .map(
            (att: { name: string; email: string }) =>
              `ATTENDEE;CN=${escapeICSText(att.name)};RSVP=TRUE;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT;CUTYPE=INDIVIDUAL;X-NUM-GUESTS=0;RSVP=FALSE;PARTSTAT=NEEDS-ACTION;X-ATTENDEE-OPTIONAL=TRUE:mailto:${att.email}`,
          )
          .join("\n");
      } else {
        attendeesStr = ATTENDEES.map(
          (att) =>
            `ATTENDEE;CN=${escapeICSText(att.name)};RSVP=TRUE;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT;CUTYPE=INDIVIDUAL;X-NUM-GUESTS=0;RSVP=FALSE;PARTSTAT=NEEDS-ACTION;X-ATTENDEE-OPTIONAL=TRUE:mailto:${att.email}`,
        ).join("\n");
      }

      return `BEGIN:VEVENT
UID:${uid}
DTSTAMP:${dtstamp}
SUMMARY:${escapeICSText(event.title || "No Title")}
DTSTART;TZID=Australia/Hobart:${dtstart}
DTEND;TZID=Australia/Hobart:${dtend}
LOCATION:${escapeICSText(event.location || "")}
DESCRIPTION:${description}
${attendeesStr}
BEGIN:VALARM
TRIGGER:-PT30M
ACTION:DISPLAY
DESCRIPTION:Reminder
END:VALARM
END:VEVENT`;
    })
    .join("\n");

  const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Streamlink//LLM AV Calendar//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
${timezoneBlock}
${icsEvents}
END:VCALENDAR`;

  return ics;
}

// Format ISO datetime string to ICS date/time format (YYYYMMDDTHHMMSS)
function formatDateTimeICS(dt: string): string {
  // Example: 2025-06-30T08:00:00+10:00 -> 20250630T080000
  // Remove timezone offset because we specify TZID
  return dt
    .replace(/-|:/g, "")
    .split("+")[0]
    .split("Z")[0];
}

// Escape special characters in ICS text fields
function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

// Send email with .ics attachment using Cloudflare Worker email sending (Mail API)
// NOTE: You need to have Mail API enabled and configured in your environment.
// If you use a 3rd party SMTP or webhook, adjust accordingly.
async function sendEmailWithICS(
  env: Env,
  params: { to: string; subject: string; body: string; ics: string },
) {
  const boundary = `----=_Part_${Math.random().toString(36).substring(2, 15)}`;

  const mailBody = [
    `--${boundary}`,
    `Content-Type: text/plain; charset="utf-8"`,
    `Content-Transfer-Encoding: 7bit`,
    ``,
    params.body,
    ``,
    `--${boundary}`,
    `Content-Type: text/calendar; method=REQUEST; charset="utf-8"`,
    `Content-Transfer-Encoding: 7bit`,
    `Content-Disposition: attachment; filename="invite.ics"`,
    ``,
    params.ics,
    ``,
    `--${boundary}--`,
  ].join("\r\n");

  const mailHeaders = {
    "Content-Type": `multipart/mixed; boundary="${boundary}"`,
  };

  // Use the environment binding to send the mail
  // This example assumes you have a Mail API binding named MAIL
  // Adjust the below to your provider/method or use a 3rd party service via fetch()

  // Example using fetch to a mail endpoint (you must set this up):
  /*
  await fetch(env.MAIL_ENDPOINT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: params.to,
      subject: params.subject,
      body: mailBody,
      headers: mailHeaders,
    }),
  });
  */

  // Placeholder: just log for now as no Mail API details provided
  console.log(`Sending email to ${params.to} with .ics attachment:\n${params.subject}`);
  console.log(mailBody);
}
