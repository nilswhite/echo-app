/**
 * Recording store — flat-file rewrite of Strata's SQLite-backed equivalent.
 *
 * Audio files: userData/recordings/<id>.<ext>
 * Metadata:    userData/recordings.json — single JSON array, atomic writes.
 *
 * No SQLite, no migrations, no orphan resume. If Echo crashes mid-job, the recording
 * file is still on disk and the metadata reflects the last persisted status.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';

export type RecordingStatus =
  | 'pending'      // created, no audio uploaded yet
  | 'uploaded'     // audio file written, awaiting finalize
  | 'finalizing'   // job kicked off (Step 5+ uses this)
  | 'transcribing'
  | 'transcribed'
  | 'structured'   // Claude/GPT pass done
  | 'written'      // Markdown landed in vault
  | 'error';

export interface Recording {
  id: string;
  audioFormat: string;
  fileExt: string;
  status: RecordingStatus;
  durationSeconds: number;
  fileSizeBytes: number;
  errorMessage?: string;
  userTitle?: string;
  createdAt: string;
  updatedAt: string;
}

function recordingsDir(): string {
  return path.join(app.getPath('userData'), 'recordings');
}

function metaFile(): string {
  return path.join(app.getPath('userData'), 'recordings.json');
}

function ensureDirs(): void {
  fs.mkdirSync(recordingsDir(), { recursive: true });
}

let cache: Recording[] | null = null;

function loadAll(): Recording[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(metaFile(), 'utf-8')) as Recording[];
  } catch {
    cache = [];
  }
  return cache!;
}

function saveAll(records: Recording[]): void {
  ensureDirs();
  const tmp = `${metaFile()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
  fs.renameSync(tmp, metaFile());
  cache = records;
}

export function createRecording(audioFormat: string): Recording {
  const id = `rec_${crypto.randomBytes(8).toString('hex')}`;
  const fileExt = audioFormat.toLowerCase().replace(/[^a-z0-9]/g, '') || 'webm';
  const now = new Date().toISOString();
  const rec: Recording = {
    id,
    audioFormat,
    fileExt,
    status: 'pending',
    durationSeconds: 0,
    fileSizeBytes: 0,
    createdAt: now,
    updatedAt: now,
  };
  const all = loadAll();
  all.push(rec);
  saveAll(all);
  return rec;
}

export function getRecording(id: string): Recording | null {
  return loadAll().find((r) => r.id === id) || null;
}

export function getRecordingPath(rec: Recording): string {
  return path.join(recordingsDir(), `${rec.id}.${rec.fileExt}`);
}

export function updateRecording(id: string, patch: Partial<Recording>): Recording | null {
  const all = loadAll();
  const idx = all.findIndex((r) => r.id === id);
  if (idx === -1) return null;
  const next: Recording = {
    ...all[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  all[idx] = next;
  saveAll(all);
  return next;
}

export function setStatus(id: string, status: RecordingStatus, errorMessage?: string): Recording | null {
  return updateRecording(id, { status, ...(errorMessage !== undefined ? { errorMessage } : {}) });
}

export function writeAudio(id: string, buffer: Buffer): Recording | null {
  ensureDirs();
  const rec = getRecording(id);
  if (!rec) return null;
  const filePath = getRecordingPath(rec);
  fs.writeFileSync(filePath, buffer);
  return updateRecording(id, {
    status: 'uploaded',
    fileSizeBytes: fs.statSync(filePath).size,
  });
}

export function deleteRecording(id: string): boolean {
  const rec = getRecording(id);
  if (!rec) return false;
  try { fs.unlinkSync(getRecordingPath(rec)); } catch { /* ignore */ }
  const remaining = loadAll().filter((r) => r.id !== id);
  saveAll(remaining);
  return true;
}
