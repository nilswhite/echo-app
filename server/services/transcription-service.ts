/**
 * Transcription service — OpenAI Whisper with ffmpeg-based chunking for files >25 MB.
 *
 * Ported from Strata's `transcription-service.ts` verbatim, with the settings-store
 * import repointed at Echo's slim variant. The chunking + hallucination filter logic
 * is unchanged — those are battle-tested in Strata's production use.
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
}

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

    for (const chunkName of chunkFiles) {
      const chunkPath = path.join(tmpDir, chunkName);
      const chunkSize = fs.statSync(chunkPath).size;
      if (chunkSize > WHISPER_FILE_LIMIT_BYTES) {
        stitchedTextParts.push(`[segment ${chunkName} too large to transcribe]`);
        offsetSeconds += CHUNK_SECONDS;
        continue;
      }
      const chunkResult = await transcribeSingleFile(client, chunkPath, options);
      if (chunkResult.diarized && chunkResult.diarized.length > 0) {
        for (const seg of chunkResult.diarized) {
          stitchedSegments.push({
            ...seg,
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
      model: 'whisper-1',
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

  const response = await client.audio.transcriptions.create({
    model: 'whisper-1',
    file,
    language: options?.language || 'en',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  });

  const segments = (response as any).segments || [];
  const diarized: DiarizedSegment[] = segments.map((seg: any) => ({
    speaker: 'Speaker',
    text: seg.text?.trim() || '',
    startSeconds: seg.start || 0,
    endSeconds: seg.end || 0,
  }));

  const duration = segments.length > 0
    ? segments[segments.length - 1].end || 0
    : (response as any).duration || 0;

  return {
    text: response.text,
    diarized: diarized.length > 0 ? diarized : undefined,
    durationSeconds: duration,
    provider: 'openai',
    model: 'whisper-1',
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
