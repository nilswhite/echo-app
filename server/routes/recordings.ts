/**
 * Recording routes — slim port of Strata's recording flow.
 *
 *   POST /recordings/start              → create record, return id
 *   POST /recordings/:id/upload         → multer-buffered audio
 *   POST /recordings/:id/stop           → save duration
 *   POST /recordings/:id/finalize       → kick off the transcription job (Step 5+)
 *   GET  /recordings/:id/job-status     → poll the in-memory job state (Step 5+)
 *
 * For Step 4, finalize just marks status = 'finalizing' so the e2e flow works
 * end-to-end without transcription. Step 5 wires `runTranscriptionJob`.
 */

import { Router } from 'express';
import multer from 'multer';
import {
  createRecording,
  getRecording,
  setStatus,
  updateRecording,
  writeAudio,
} from '../services/recording-store.js';
import { runTranscriptionJob } from '../services/recording-job-runner.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

export const recordingsRouter: Router = Router();

recordingsRouter.post('/recordings/start', (req, res) => {
  const audioFormat = (req.body?.audioFormat as string) || 'webm';
  const rec = createRecording(audioFormat);
  res.json(rec);
});

recordingsRouter.post('/recordings/:id/upload', upload.single('audio'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No audio file uploaded' });
  const rec = writeAudio(req.params.id, req.file.buffer);
  if (!rec) return res.status(404).json({ error: 'Recording not found' });
  res.json(rec);
});

recordingsRouter.post('/recordings/:id/stop', (req, res) => {
  const duration = Number(req.body?.durationSeconds) || 0;
  const rec = updateRecording(req.params.id, { durationSeconds: duration });
  if (!rec) return res.status(404).json({ error: 'Recording not found' });
  res.json(rec);
});

recordingsRouter.post('/recordings/:id/finalize', (req, res) => {
  const rec = getRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Recording not found' });
  const userTitle = String(req.body?.userTitle || '').trim();
  const attendeesRaw = Array.isArray(req.body?.attendees) ? req.body.attendees : [];
  const attendees = attendeesRaw
    .map((a: unknown) => (typeof a === 'string' ? a.trim() : ''))
    .filter((a: string) => a.length > 0);
  const userNotes = String(req.body?.userNotes || '').trim();
  const updated = updateRecording(rec.id, {
    status: 'finalizing',
    ...(userTitle ? { userTitle } : {}),
    ...(attendees.length ? { attendees } : {}),
    ...(userNotes ? { userNotes } : {}),
  });
  // Fire-and-forget: client gets 202 immediately, transcription runs in the background.
  runTranscriptionJob(rec.id).catch((err) => {
    console.error(`[recordings] job for ${rec.id} threw:`, err);
  });
  res.status(202).json(updated);
});

recordingsRouter.get('/recordings/:id', (req, res) => {
  const rec = getRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Recording not found' });
  res.json(rec);
});

recordingsRouter.get('/recordings/:id/job-status', (req, res) => {
  const rec = getRecording(req.params.id);
  if (!rec) return res.status(404).json({ error: 'Recording not found' });
  res.json({ status: rec.status, errorMessage: rec.errorMessage });
});
