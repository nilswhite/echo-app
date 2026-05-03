/**
 * Recording job runner — fire-and-forget post-finalize pipeline.
 *
 * Stages:
 *   1. Pre-flight: file exists, non-trivial size (silence guard)
 *   2. Transcribe via Whisper (chunking handled by transcription-service)
 *   3. Hallucination filter on tiny outputs
 *   4. Structure → Markdown → vault (Step 6 fills this in)
 *
 * For Step 5: writes the raw transcript as a stub `.md` in the vault inbox so
 * the end-to-end flow is observable. Step 6 swaps the stub for a structured Claude/GPT output.
 *
 * Job state lives in an in-memory map keyed by recordingId. We persist terminal
 * status to the recording record so Echo restarts don't lose the trace.
 */

import fs from 'fs';
import { getRecording, getRecordingPath, setStatus } from './recording-store.js';
import { transcribeAudio, isLikelyHallucination } from './transcription-service.js';
import { writeMarkdownToVault } from './obsidian-writer.js';
import { structureTranscript } from './markdown-structurer.js';

const SILENCE_FILE_SIZE_THRESHOLD = 20 * 1024;
const activeJobs = new Map<string, Promise<void>>();

export function isJobActive(recordingId: string): boolean {
  return activeJobs.has(recordingId);
}

export function runTranscriptionJob(recordingId: string): Promise<void> {
  const existing = activeJobs.get(recordingId);
  if (existing) return existing;
  const job = runJob(recordingId).finally(() => activeJobs.delete(recordingId));
  activeJobs.set(recordingId, job);
  return job;
}

async function runJob(recordingId: string): Promise<void> {
  const rec = getRecording(recordingId);
  if (!rec) {
    console.error(`[job] recording ${recordingId} not found`);
    return;
  }

  const audioPath = getRecordingPath(rec);
  if (!fs.existsSync(audioPath)) {
    setStatus(recordingId, 'error', 'Audio file missing from disk.');
    return;
  }

  const size = fs.statSync(audioPath).size;
  if (size < SILENCE_FILE_SIZE_THRESHOLD) {
    setStatus(recordingId, 'error', 'Recording is too short or appears silent.');
    await writeMarkdownToVault({
      recordingId,
      title: 'Echo — silent recording',
      type: 'meeting',
      durationSeconds: rec.durationSeconds,
      sections: { summary: '', actionItems: [], keyPoints: [], transcript: '' },
      flagged: 'Recording was too short or appears silent. Audio file preserved.',
      audioPath,
    }).catch(() => undefined);
    return;
  }

  try {
    setStatus(recordingId, 'transcribing');
    const result = await transcribeAudio(audioPath);
    setStatus(recordingId, 'transcribed');

    if (isLikelyHallucination(result.text)) {
      setStatus(recordingId, 'error', 'Transcript appears to be Whisper silence hallucination.');
      await writeMarkdownToVault({
        recordingId,
        title: 'Echo — empty transcript',
        type: 'meeting',
        durationSeconds: result.durationSeconds || rec.durationSeconds,
        sections: { summary: '', actionItems: [], keyPoints: [], transcript: result.text },
        flagged: 'Transcript looked like a silence hallucination. Audio preserved.',
        audioPath,
      });
      return;
    }

    setStatus(recordingId, 'structured');
    const structured = await structureTranscript(result.text);

    if (!structured) {
      // Structuring failed — still drop a usable note with the raw transcript so nothing is lost.
      await writeMarkdownToVault({
        recordingId,
        title: 'Echo recording — structuring failed',
        type: 'meeting',
        durationSeconds: result.durationSeconds || rec.durationSeconds,
        sections: { summary: '', actionItems: [], keyPoints: [], transcript: result.text },
        flagged: 'AI structuring failed. Raw transcript preserved below.',
        audioPath,
      });
      setStatus(recordingId, 'written');
      return;
    }

    await writeMarkdownToVault({
      recordingId,
      // User-provided title (typed in the pill) takes precedence over AI-generated title.
      title: rec.userTitle?.trim() || structured.title,
      type: 'meeting',
      durationSeconds: result.durationSeconds || rec.durationSeconds,
      sections: {
        summary: structured.summary,
        actionItems: structured.actionItems,
        keyPoints: structured.keyPoints,
        transcript: result.text,
      },
      audioPath,
    });
    setStatus(recordingId, 'written');
  } catch (err) {
    const msg = (err as Error).message || String(err);
    console.error(`[job] ${recordingId} failed:`, msg);
    setStatus(recordingId, 'error', msg);
    await writeMarkdownToVault({
      recordingId,
      title: 'Echo — transcription failed',
      type: 'meeting',
      durationSeconds: rec.durationSeconds,
      sections: { summary: '', actionItems: [], keyPoints: [], transcript: '' },
      flagged: msg,
      audioPath,
    }).catch(() => undefined);
  }
}
