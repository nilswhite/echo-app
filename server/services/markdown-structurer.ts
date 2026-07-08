/**
 * Markdown structurer — single schema-enforced call that produces the small
 * structured fields plus an optional `speakerMap` that maps diarized speaker
 * labels (`A`, `B`, `1A`, `2B`, …) to attendee names.
 *
 * Anthropic path uses `client.messages.parse()` with `output_config.format =
 * jsonSchemaOutputFormat(...)`, so the model's output is schema-enforced — no
 * more "model emitted broken JSON, parse failed, the title and summary are gone"
 * failure mode. OpenAI path uses `responses.create` with `text.format` set to
 * a JSON schema for the same enforcement.
 *
 * Returns null on any failure so the job runner can fall back to writing a
 * flagged stub with the raw transcript instead of crashing.
 */

import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import OpenAI from 'openai';
import type { DiarizedSegment } from './transcription-service.js';
import { getSettings, getOpenAIKey, getAnthropicKey } from './settings-store.js';

export interface Structured {
  title: string;
  summary: string;
  actionItems: string[];
  keyPoints: string[];
  /**
   * Maps diarized speaker labels to attendee names (e.g. `{ "A": "You",
   * "B": "Alice Chen" }`). Only present when both attendees and a diarized
   * transcript were provided. Unmapped labels render as `Speaker <label>`.
   */
  speakerMap?: Record<string, string>;
}

const STRUCTURE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'actionItems', 'keyPoints'],
  properties: {
    title: { type: 'string', description: '4-10 words, plain prose, no quotes, no leading "Meeting:"' },
    summary: { type: 'string', description: '2-4 sentences, plain prose, no bullets' },
    actionItems: {
      type: 'array',
      items: { type: 'string' },
      description: 'Imperative, single-line. Empty array if none. Do NOT invent.',
    },
    keyPoints: {
      type: 'array',
      items: { type: 'string' },
      description: '3-7 short bullets capturing the substantive points discussed',
    },
    speakerMap: {
      type: 'object',
      description: 'Map diarized speaker labels to attendee names; "You" for the recording owner.',
      additionalProperties: { type: 'string' },
    },
  },
} as const;

function buildSystemPrompt(opts: { hasAttendees: boolean; hasDiarization: boolean; hasUserNotes: boolean }): string {
  const lines: string[] = [
    `You are an editor for a personal knowledge management system.`,
    ``,
    `You receive the raw transcript of a recording — usually a meeting, sometimes a solo voice memo — and you produce a small set of structured fields that will land as a Markdown note in the user's Obsidian inbox.`,
    ``,
    `Style:`,
    `- Be terse. Cut filler. Prefer short sentences.`,
    `- Action items must be real commitments — not "discuss X further". If unclear, leave them out.`,
    `- Don't invent attendees, dates, or numbers that aren't in the transcript.`,
    `- If the transcript is unclear or empty, return reasonable defaults but don't fabricate content.`,
  ];

  if (opts.hasAttendees) {
    lines.push(
      ``,
      `Attendees:`,
      `- The user message includes an "Attendees:" section. Use the EXACT spelling from that list anywhere a person is mentioned in the summary, action items, or key points.`,
    );
  }

  if (opts.hasUserNotes) {
    lines.push(
      ``,
      `User notes (HIGH PRIORITY):`,
      `- The user message includes a "User notes:" section. These were written by the user during or right after the meeting — they are the points the user most wants captured.`,
      `- Treat them as authoritative about what matters. Every concrete decision, action item, or fact the user noted MUST be reflected in your summary, action items, or key points. Do not drop a user note just because the transcript covers it only lightly.`,
      `- Where a user note and the transcript conflict on intent or emphasis, prefer the user note.`,
      `- Do NOT, however, invent details that appear in neither the notes nor the transcript. Use the notes to decide what to surface, not as license to fabricate.`,
    );
  }

  if (opts.hasDiarization) {
    lines.push(
      ``,
      `Speaker mapping:`,
      `- The transcript is pre-segmented by speaker; each segment is prefixed with a label like "A:", "B:", "1A:", or "2B:" (the digit prefix appears for multi-chunk recordings; treat each prefix+letter pair as one speaker).`,
      `- Produce a "speakerMap" object that maps each label to a person. Use the EXACT spelling from the attendee list, or "You" for the recording's owner (first-person framing, presenting a topic, asking a question of the group).`,
      `- If you cannot determine who a label refers to with reasonable confidence, OMIT it from the map. Do NOT guess.`,
    );
  } else {
    lines.push(
      ``,
      `Do NOT echo the transcript back. The transcript stays as-is in the note; you only produce the structured fields above.`,
    );
  }

  return lines.join('\n');
}

export interface StructureOptions {
  attendees?: string[];
  /** Diarized speaker segments. When present, `text` is ignored and segments are formatted as the user message. */
  segments?: DiarizedSegment[];
  /** Free-form notes the user typed in the capture panel. Prioritized in the summary. */
  userNotes?: string;
}

export async function structureTranscript(
  text: string,
  opts: StructureOptions = {},
): Promise<Structured | null> {
  const { structuringProvider, structuringModel } = getSettings();
  const attendees = (opts.attendees || []).filter((a) => a.trim().length > 0);
  const segments = opts.segments || [];
  const notes = (opts.userNotes || '').trim();
  const hasAttendees = attendees.length > 0;
  const hasDiarization = segments.length > 0;
  const hasUserNotes = notes.length > 0;

  const attendeesBlock = hasAttendees
    ? `Attendees:\n${attendees.map((a) => `- ${a}`).join('\n')}\n\n`
    : '';

  // User notes go BEFORE the transcript so the model reads the user's priorities first.
  const userNotesBlock = hasUserNotes
    ? `User notes:\n${notes}\n\n`
    : '';

  const transcriptBlock = hasDiarization
    ? `Transcript (diarized):\n\n${segments.map((s) => `${s.speaker}: ${s.text}`).join('\n')}`
    : `Transcript:\n\n${text.trim()}`;

  const userMsg = `${attendeesBlock}${userNotesBlock}${transcriptBlock}`;
  const systemPrompt = buildSystemPrompt({ hasAttendees, hasDiarization, hasUserNotes });

  try {
    return structuringProvider === 'openai'
      ? await callOpenAI(structuringModel, systemPrompt, userMsg)
      : await callAnthropic(structuringModel, systemPrompt, userMsg);
  } catch (err) {
    console.error('[structurer] failed:', (err as Error).message);
    return null;
  }
}

async function callAnthropic(
  model: string,
  systemPrompt: string,
  userMsg: string,
): Promise<Structured | null> {
  const apiKey = getAnthropicKey();
  if (!apiKey) throw new Error('No Anthropic API key configured.');
  const client = new Anthropic({ apiKey });

  const response = await client.messages.parse({
    model,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMsg }],
    output_config: {
      format: jsonSchemaOutputFormat(STRUCTURE_SCHEMA),
    },
  });

  if (response.stop_reason === 'max_tokens') {
    console.warn('[structurer] Claude hit max_tokens; output may be truncated');
  }

  const parsed = response.parsed_output as Partial<Structured> | null;
  return normalizeStructured(parsed);
}

async function callOpenAI(
  model: string,
  systemPrompt: string,
  userMsg: string,
): Promise<Structured | null> {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new Error('No OpenAI API key configured.');
  const client = new OpenAI({ apiKey });

  const response = await client.responses.create({
    model,
    instructions: systemPrompt,
    input: userMsg,
    max_output_tokens: 4096,
    prompt_cache_key: 'echo-structurer-v3',
    text: {
      format: {
        type: 'json_schema',
        name: 'echo_structured',
        schema: STRUCTURE_SCHEMA as Record<string, unknown>,
        strict: false,
      },
    },
  } as any);

  const raw = response.output_text || '';
  if (!raw) return null;
  try {
    return normalizeStructured(JSON.parse(raw) as Partial<Structured>);
  } catch (err) {
    console.error('[structurer] OpenAI JSON parse failed:', (err as Error).message, '— raw[0..400]:', raw.slice(0, 400));
    return null;
  }
}

function normalizeStructured(parsed: Partial<Structured> | null | undefined): Structured | null {
  if (!parsed || typeof parsed.title !== 'string' || typeof parsed.summary !== 'string') {
    console.error('[structurer] response missing title/summary');
    return null;
  }
  const speakerMap = parsed.speakerMap && typeof parsed.speakerMap === 'object'
    ? Object.fromEntries(
        Object.entries(parsed.speakerMap)
          .filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && v.trim().length > 0),
      )
    : undefined;
  return {
    title: parsed.title,
    summary: parsed.summary,
    actionItems: Array.isArray(parsed.actionItems)
      ? parsed.actionItems.filter((s): s is string => typeof s === 'string')
      : [],
    keyPoints: Array.isArray(parsed.keyPoints)
      ? parsed.keyPoints.filter((s): s is string => typeof s === 'string')
      : [],
    ...(speakerMap && Object.keys(speakerMap).length > 0 ? { speakerMap } : {}),
  };
}

/**
 * Render diarized segments as Markdown with speaker prefixes. Maps known
 * speaker labels to attendee names via `speakerMap`; unmapped labels fall back
 * to `Speaker <label>`. Falls back to flat text if no segments are present.
 */
export function renderTranscriptWithSpeakers(
  flatText: string,
  segments: DiarizedSegment[] | undefined,
  speakerMap: Record<string, string> | undefined,
): string {
  if (!segments || segments.length === 0) return flatText.trim();
  const map = speakerMap || {};
  const lines: string[] = [];
  let lastSpeaker = '';
  for (const seg of segments) {
    const display = map[seg.speaker] || `Speaker ${seg.speaker}`;
    if (display !== lastSpeaker) {
      if (lines.length > 0) lines.push('');
      lines.push(`**${display}:** ${seg.text}`);
      lastSpeaker = display;
    } else {
      // Same speaker continuing — append on the same paragraph.
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${seg.text}`;
    }
  }
  return lines.join('\n');
}
