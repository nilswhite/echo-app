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
import { structureTranscript, renderTranscriptWithSpeakers } from './markdown-structurer.js';
import { resolveAttendees } from './people-index.js';

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
      sections: { summary: '', actionItems: [], keyPoints: [], transcript: '', userNotes: rec.userNotes },
      flagged: 'Recording was too short or appears silent. Audio file preserved.',
      audioPath,
    }).catch(() => undefined);
    return;
  }

  try {
    setStatus(recordingId, 'transcribing');
    // Auto-engage diarization when attendees are provided — `gpt-4o-transcribe-diarize`
    // gives us per-segment speaker labels (A, B, C, …) which the structurer maps
    // to attendee names by context. No attendees → fall back to flat Whisper.
    const wantDiarize = (rec.attendees?.filter((a) => a.trim().length > 0) || []).length > 0;
    const result = await transcribeAudio(audioPath, {
      diarize: wantDiarize,
      // Force chunking for long-but-small recordings: low-bitrate Opus can stay under
      // the 25 MB size gate while exceeding the models' per-request duration caps
      // (flat request timeouts / the 1400s diarize cap).
      durationSeconds: rec.durationSeconds,
    });
    setStatus(recordingId, 'transcribed');

    if (isLikelyHallucination(result.text)) {
      setStatus(recordingId, 'error', 'Transcript appears to be Whisper silence hallucination.');
      await writeMarkdownToVault({
        recordingId,
        title: 'Echo — empty transcript',
        type: 'meeting',
        durationSeconds: result.durationSeconds || rec.durationSeconds,
        sections: { summary: '', actionItems: [], keyPoints: [], transcript: result.text, userNotes: rec.userNotes },
        flagged: 'Transcript looked like a silence hallucination. Audio preserved.',
        audioPath,
      });
      return;
    }

    setStatus(recordingId, 'structured');
    // Resolve attendee names against the People directory first so the structurer
    // sees the canonical spelling and uses it consistently in summary/action items.
    const resolved = resolveAttendees(rec.attendees || []);
    const canonicalAttendees = resolved.map((r) => r.display);

    const structured = await structureTranscript(result.text, {
      attendees: canonicalAttendees,
      segments: result.diarized,
      userNotes: rec.userNotes,
    });

    if (!structured) {
      // Structuring failed — still drop a usable note with the raw transcript so nothing is lost.
      const fallbackTranscript = renderTranscriptWithSpeakers(result.text, result.diarized, undefined);
      await writeMarkdownToVault({
        recordingId,
        title: 'Echo recording — structuring failed',
        type: 'meeting',
        durationSeconds: result.durationSeconds || rec.durationSeconds,
        sections: { summary: '', actionItems: [], keyPoints: [], transcript: fallbackTranscript, userNotes: rec.userNotes },
        attendees: resolved,
        flagged: 'AI structuring failed. Raw transcript preserved below.',
        audioPath,
      });
      setStatus(recordingId, 'written');
      return;
    }

    const renderedTranscript = renderTranscriptWithSpeakers(result.text, result.diarized, structured.speakerMap);

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
        transcript: renderedTranscript,
        userNotes: rec.userNotes,
      },
      attendees: resolved,
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
      sections: { summary: '', actionItems: [], keyPoints: [], transcript: '', userNotes: rec.userNotes },
      flagged: msg,
      audioPath,
    }).catch(() => undefined);
  }
}
