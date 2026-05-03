/**
 * Obsidian writer — atomic Markdown drop into the user's chosen folder.
 *
 * File layout:
 *   <vaultPath>/YYYY-MM-DD-HHmm-<slug>-<hash>.md
 *   <vaultPath>/_attachments/<basename>.<ext>     (audio, optional)
 *
 * `vaultPath` is the destination folder the user picked in Settings — Echo writes
 * directly there with no extra subfolder.
 *
 * Writes are atomic (write to .tmp then rename) so a partial write never syncs to
 * iCloud / Dropbox / Obsidian Sync. Filename includes a 4-char hash to avoid
 * same-minute collisions.
 *
 * Honors the `retainAudio` setting: when off, the audio is discarded after the
 * Markdown is written. When on, it's copied into `_attachments/` and wikilinked
 * from the Markdown body.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getSettings } from './settings-store.js';

export type EntryType = 'meeting' | 'note';

export interface WriteOptions {
  recordingId?: string;
  title: string;
  type: EntryType;
  durationSeconds?: number;
  sections: {
    summary: string;
    actionItems: string[];
    keyPoints: string[];
    transcript: string;
  };
  flagged?: string;
  audioPath?: string;
}

export interface WriteResult {
  markdownPath: string;
  audioPath?: string;
}

export async function writeMarkdownToVault(options: WriteOptions): Promise<WriteResult> {
  const { vaultPath, retainAudio } = getSettings();
  if (!vaultPath) throw new Error('No output folder configured. Open Settings… and choose where Echo should write your notes.');

  fs.mkdirSync(vaultPath, { recursive: true });

  const now = new Date();
  const baseName = buildBasename(now, options.title);
  const mdPath = path.join(vaultPath, `${baseName}.md`);

  let audioWikilink: string | undefined;
  let attachedAudioPath: string | undefined;
  if (options.audioPath && fs.existsSync(options.audioPath) && retainAudio) {
    const attachmentsDir = path.join(vaultPath, '_attachments');
    fs.mkdirSync(attachmentsDir, { recursive: true });
    const audioExt = path.extname(options.audioPath) || '.webm';
    attachedAudioPath = path.join(attachmentsDir, `${baseName}${audioExt}`);
    fs.copyFileSync(options.audioPath, attachedAudioPath);
    audioWikilink = `${baseName}${audioExt}`;
  }

  const body = buildMarkdown({
    ...options,
    createdISO: now.toISOString(),
    audioWikilink,
  });

  const tmp = `${mdPath}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, mdPath);

  return { markdownPath: mdPath, audioPath: attachedAudioPath };
}

function buildBasename(now: Date, title: string): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const slug = slugify(title);
  const hash = crypto.randomBytes(2).toString('hex');
  return `${yyyy}-${mm}-${dd}-${hh}${mi}-${slug}-${hash}`;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'untitled';
}

function buildMarkdown(opts: {
  title: string;
  type: EntryType;
  createdISO: string;
  durationSeconds?: number;
  sections: WriteOptions['sections'];
  flagged?: string;
  audioWikilink?: string;
  recordingId?: string;
}): string {
  const fm: string[] = ['---'];
  fm.push(`created: ${opts.createdISO}`);
  fm.push(`type: ${opts.type}`);
  if (opts.durationSeconds) fm.push(`duration: ${formatDuration(opts.durationSeconds)}`);
  fm.push(`source: echo`);
  if (opts.recordingId) fm.push(`recording_id: ${opts.recordingId}`);
  if (opts.flagged) {
    fm.push(`status: error`);
    fm.push(`error: "${opts.flagged.replace(/"/g, '\\"')}"`);
  }
  fm.push('---', '');

  const out: string[] = [fm.join('\n'), `# ${opts.title}`, ''];

  if (opts.flagged) {
    out.push(`> [!warning] ${opts.flagged}`);
    out.push('');
  }

  if (opts.sections.summary?.trim()) {
    out.push('## Summary', '', opts.sections.summary.trim(), '');
  }

  if (opts.sections.actionItems?.length) {
    out.push('## Action Items', '');
    for (const item of opts.sections.actionItems) out.push(`- [ ] ${item}`);
    out.push('');
  }

  if (opts.sections.keyPoints?.length) {
    out.push('## Key Points', '');
    for (const point of opts.sections.keyPoints) out.push(`- ${point}`);
    out.push('');
  }

  if (opts.audioWikilink) {
    out.push('## Audio', '', `![[${opts.audioWikilink}]]`, '');
  }

  if (opts.sections.transcript?.trim()) {
    out.push('## Transcript', '', opts.sections.transcript.trim(), '');
  }

  return out.join('\n');
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m === 0) return `${s}s`;
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}
