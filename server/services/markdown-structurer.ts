/**
 * Markdown structurer — turns a raw transcript into structured sections.
 *
 * Provider-agnostic: dispatches to Anthropic SDK or OpenAI Responses API based on
 * `settings.structuringProvider` + `settings.structuringModel`. Single call, JSON
 * output. Prompt-cached system prompt to keep repeat-call cost down (the system
 * prompt is identical across recordings; only the user message changes).
 *
 * Returns null on any failure so the job runner can fall back to writing a flagged
 * stub with the raw transcript instead of crashing.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getSettings, getOpenAIKey, getAnthropicKey } from './settings-store.js';

export interface Structured {
  title: string;
  summary: string;
  actionItems: string[];
  keyPoints: string[];
}

const SYSTEM_PROMPT = `You are an editor for a personal knowledge management system.

You receive the raw transcript of a recording — usually a meeting, sometimes a solo voice memo — and you produce four structured fields that will land as a Markdown note in the user's Obsidian inbox.

Return ONLY valid JSON matching this schema, with no surrounding text or markdown fencing:

{
  "title": string,            // 4-10 words, plain prose, no quotes, no leading "Meeting:" or similar
  "summary": string,          // 2-4 sentences, plain prose, no bullets
  "actionItems": string[],    // imperative, single-line. Empty array if there are none. Do NOT invent items.
  "keyPoints": string[]       // 3-7 short bullets capturing the substantive points discussed
}

Style:
- Be terse. Cut filler. Prefer short sentences.
- Action items must be real commitments — not "discuss X further". If unclear, leave them out.
- Don't invent attendees, dates, or numbers that aren't in the transcript.
- If the transcript is unclear or empty, return reasonable defaults but don't fabricate content.`;

export async function structureTranscript(transcript: string): Promise<Structured | null> {
  const { structuringProvider, structuringModel } = getSettings();
  const userMsg = `Transcript:\n\n${transcript.trim()}`;

  try {
    const raw = structuringProvider === 'openai'
      ? await callOpenAI(structuringModel, userMsg)
      : await callAnthropic(structuringModel, userMsg);
    return parseStructured(raw);
  } catch (err) {
    console.error('[structurer] failed:', (err as Error).message);
    return null;
  }
}

async function callAnthropic(model: string, userMsg: string): Promise<string> {
  const apiKey = getAnthropicKey();
  if (!apiKey) throw new Error('No Anthropic API key configured.');
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      { role: 'user', content: userMsg },
    ],
  });

  const block = response.content.find((b) => b.type === 'text');
  if (!block || block.type !== 'text') throw new Error('No text in Claude response');
  return block.text;
}

async function callOpenAI(model: string, userMsg: string): Promise<string> {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new Error('No OpenAI API key configured.');
  const client = new OpenAI({ apiKey });

  const response = await client.responses.create({
    model,
    instructions: SYSTEM_PROMPT,
    input: userMsg,
    max_output_tokens: 4096,
    prompt_cache_key: 'echo-structurer-v1',
  });

  return response.output_text;
}

function parseStructured(raw: string): Structured | null {
  // Some providers wrap JSON in code fences despite instructions; strip if present.
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(stripped) as Partial<Structured>;
    if (typeof parsed.title !== 'string' || typeof parsed.summary !== 'string') return null;
    return {
      title: parsed.title,
      summary: parsed.summary,
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems.filter((s): s is string => typeof s === 'string') : [],
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.filter((s): s is string => typeof s === 'string') : [],
    };
  } catch {
    return null;
  }
}
