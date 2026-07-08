/**
 * Transcription service — OpenAI audio transcription with ffmpeg-based chunking
 * for files >25 MB.
 *
 * Two models supported:
 *   - `gpt-4o-transcribe` (default) — flat text, no speaker labels. Newer GPT-4o-
 *     based model that materially outperforms the legacy `whisper-1` on accented
 *     speech and noisy audio at the same per-minute price. Used when the caller
 *     doesn't ask for diarization.
 *   - `gpt-4o-transcribe-diarize` — opt-in via `options.diarize`. Returns segments
 *     with sequential speaker labels (`A`, `B`, `C`, …). For multi-chunk audio,
 *     speaker labels are independent per chunk, so we prefix labels with the chunk
 *     index (`1A`, `2A`, …) to avoid collisions across chunks. The downstream
 *     structurer maps these prefixed labels to attendee names by context.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import ffmpegPathRaw from 'ffmpeg-static';
import OpenAI from 'openai';
import { getOpenAIKey } from './settings-store.js';

// ffmpeg-static returns an asar path in packaged apps; the binary must live in app.asar.unpacked
// to be executable. forge.config.ts unpacks the ffmpeg-static dir, so we rewrite the path here.
const ffmpegPath: string = typeof ffmpegPathRaw === 'string'
  ? ffmpegPathRaw.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep).replace('app.asar/', 'app.asar.unpacked/')
  : '';

const CHUNK_SECONDS = 300;
const WHISPER_FILE_LIMIT_BYTES = 25 * 1024 * 1024;

export interface DiarizedSegment {
  speaker: string;
  text: string;
  startSeconds: number;
  endSeconds: number;
}

export interface TranscriptionResult {
  text: string;
  diarized?: DiarizedSegment[];
  durationSeconds: number;
  provider: string;
  model: string;
}

export interface TranscriptionOptions {
  language?: string;
  /**
   * When true, route to `gpt-4o-transcribe-diarize` and return per-segment
   * speaker labels. Auto-engaged by the job runner when attendees are provided.
   */
  diarize?: boolean;
}

const DIARIZE_MODEL = 'gpt-4o-transcribe-diarize';
const FLAT_MODEL = 'gpt-4o-transcribe';

export async function transcribeAudio(
  audioPath: string,
  options?: TranscriptionOptions,
): Promise<TranscriptionResult> {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new Error('No OpenAI API key configured. Add one in Echo Settings.');
  const client = new OpenAI({ apiKey });

  const stat = fs.statSync(audioPath);
  if (stat.size > WHISPER_FILE_LIMIT_BYTES) return transcribeChunked(client, audioPath, options);
  return transcribeSingleFile(client, audioPath, options);
}

async function transcribeChunked(
  client: OpenAI,
  audioPath: string,
  options?: TranscriptionOptions,
): Promise<TranscriptionResult> {
  if (!ffmpegPath) {
    throw new Error('ffmpeg binary not available — cannot split oversize audio for transcription.');
  }

  const tmpDir = path.join(path.dirname(audioPath), `.chunks-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  try {
    const ext = path.extname(audioPath).slice(1) || 'webm';
    const segmentPattern = path.join(tmpDir, `chunk-%03d.${ext}`);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath, [
        '-y',
        '-i', audioPath,
        '-c', 'copy',
        '-f', 'segment',
        '-segment_time', String(CHUNK_SECONDS),
        '-reset_timestamps', '1',
        segmentPattern,
      ]);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`));
      });
    });

    const chunkFiles = fs.readdirSync(tmpDir).filter((f) => f.startsWith('chunk-')).sort();
    if (chunkFiles.length === 0) throw new Error('ffmpeg produced no segments — the audio file may be corrupted.');

    const stitchedSegments: DiarizedSegment[] = [];
    const stitchedTextParts: string[] = [];
    let offsetSeconds = 0;

    for (let i = 0; i < chunkFiles.length; i++) {
      const chunkName = chunkFiles[i];
      const chunkPath = path.join(tmpDir, chunkName);
      const chunkSize = fs.statSync(chunkPath).size;
      if (chunkSize > WHISPER_FILE_LIMIT_BYTES) {
        stitchedTextParts.push(`[segment ${chunkName} too large to transcribe]`);
        offsetSeconds += CHUNK_SECONDS;
        continue;
      }
      const chunkResult = await transcribeSingleFile(client, chunkPath, options);
      if (chunkResult.diarized && chunkResult.diarized.length > 0) {
        // Per-chunk speaker labels are independent. Prefix with chunk index when
        // there's more than one chunk so the downstream structurer can disambiguate.
        const prefix = chunkFiles.length > 1 ? String(i + 1) : '';
        for (const seg of chunkResult.diarized) {
          stitchedSegments.push({
            ...seg,
            speaker: prefix ? `${prefix}${seg.speaker}` : seg.speaker,
            startSeconds: seg.startSeconds + offsetSeconds,
            endSeconds: seg.endSeconds + offsetSeconds,
          });
        }
      }
      if (chunkResult.text) stitchedTextParts.push(chunkResult.text.trim());
      offsetSeconds += chunkResult.durationSeconds || CHUNK_SECONDS;
    }

    return {
      text: stitchedTextParts.join(' '),
      diarized: stitchedSegments.length > 0 ? stitchedSegments : undefined,
      durationSeconds: offsetSeconds,
      provider: 'openai',
      model: options?.diarize ? DIARIZE_MODEL : FLAT_MODEL,
    };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

async function transcribeSingleFile(
  client: OpenAI,
  audioPath: string,
  options?: TranscriptionOptions,
): Promise<TranscriptionResult> {
  const file = new File(
    [fs.readFileSync(audioPath)],
    path.basename(audioPath),
    { type: getMimeType(audioPath) },
  );

  if (options?.diarize) {
    return transcribeDiarized(client, file, options);
  }
  return transcribeFlat(client, file, options);
}

async function transcribeFlat(
  client: OpenAI,
  file: File,
  options?: TranscriptionOptions,
): Promise<TranscriptionResult> {
  // gpt-4o-transcribe only supports response_format = 'json' (no verbose_json /
  // timestamp_granularities). We don't actually use the per-segment timing on the
  // flat path — duration is filled in by the renderer caller from rec.durationSeconds.
  const response = await client.audio.transcriptions.create({
    model: FLAT_MODEL,
    file,
    language: options?.language || 'en',
  });

  return {
    text: response.text,
    durationSeconds: 0,
    provider: 'openai',
    model: FLAT_MODEL,
  };
}

async function transcribeDiarized(
  client: OpenAI,
  file: File,
  options?: TranscriptionOptions,
): Promise<TranscriptionResult> {
  const response = await client.audio.transcriptions.create({
    model: DIARIZE_MODEL,
    file,
    language: options?.language || 'en',
    response_format: 'diarized_json',
    // Required by gpt-4o-transcribe-diarize for inputs >30s; without it the API
    // refuses long audio. 'auto' uses server-side VAD-based segmentation.
    chunking_strategy: 'auto',
  } as any);
  // The diarized response is shaped per `TranscriptionDiarized`:
  //   { text, segments: [{ speaker, start, end, text, ... }], duration, ... }
  const r = response as any;
  const segments = Array.isArray(r.segments) ? r.segments : [];
  const diarized: DiarizedSegment[] = segments.map((seg: any) => ({
    speaker: typeof seg.speaker === 'string' && seg.speaker ? seg.speaker : '?',
    text: typeof seg.text === 'string' ? seg.text.trim() : '',
    startSeconds: typeof seg.start === 'number' ? seg.start : 0,
    endSeconds: typeof seg.end === 'number' ? seg.end : 0,
  })).filter((seg: DiarizedSegment) => seg.text.length > 0);

  const duration = typeof r.duration === 'number'
    ? r.duration
    : (diarized.length > 0 ? diarized[diarized.length - 1].endSeconds : 0);

  return {
    text: typeof r.text === 'string' ? r.text : diarized.map((s) => s.text).join(' '),
    diarized: diarized.length > 0 ? diarized : undefined,
    durationSeconds: duration,
    provider: 'openai',
    model: DIARIZE_MODEL,
  };
}

const HALLUCINATION_NORMALIZED = new Set([
  '', 'you', 'thanks', 'thank you', 'thanks for watching', 'thanks for watching the video',
  'bye', 'bye bye', 'goodbye', "i'm sorry", 'yeah', 'okay', 'ok', 'mm', 'hmm', 'uh',
  'thank you for watching', 'subscribe', 'like and subscribe',
]);

function normalizeForHallucinationCheck(text: string): string {
  return text.toLowerCase().replace(/[^\w\s']/g, '').replace(/\s+/g, ' ').trim();
}

export function isLikelyHallucination(text: string): boolean {
  const normalized = normalizeForHallucinationCheck(text);
  if (!normalized) return true;
  if (normalized.length > 40) return false;
  return HALLUCINATION_NORMALIZED.has(normalized);
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.mp3': return 'audio/mpeg';
    case '.m4a': return 'audio/mp4';
    case '.wav': return 'audio/wav';
    case '.webm': return 'audio/webm';
    case '.ogg': return 'audio/ogg';
    default: return 'audio/mpeg';
  }
}
