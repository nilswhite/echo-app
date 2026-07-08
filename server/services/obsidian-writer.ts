/**
 * Obsidian writer — atomic Markdown drop into the user's chosen folder.
 *
 * File layout:
 *   <vaultPath>/YYYY-MM-DD-<slug>.md
 *   <vaultPath>/_attachments/<basename>.<ext>     (audio, optional)
 *
 * `vaultPath` is the destination folder the user picked in Settings — Echo writes
 * directly there with no extra subfolder.
 *
 * Writes are atomic (write to .tmp then rename) so a partial write never syncs to
 * iCloud / Dropbox / Obsidian Sync. If two captures on the same day produce the
 * same slug, the second one becomes `YYYY-MM-DD-<slug>-2`, the third `-3`, etc.
 *
 * Honors the `retainAudio` setting: when off, the audio is discarded after the
 * Markdown is written. When on, it's copied into `_attachments/` and wikilinked
 * from the Markdown body.
 */

import fs from 'fs';
import path from 'path';
import { getSettings } from './settings-store.js';
import type { ResolvedAttendee } from './people-index.js';

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
    /** Verbatim notes the user typed during the meeting. Rendered before the transcript. */
    userNotes?: string;
  };
  /** Attendees already resolved against the People directory (matched names get wikilinks). */
  attendees?: ResolvedAttendee[];
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
  const audioExt = options.audioPath ? (path.extname(options.audioPath) || '.webm') : '';
  const attachmentsDir = path.join(vaultPath, '_attachments');
  const baseName = resolveBasename(now, options.title, vaultPath, attachmentsDir, audioExt);
  const mdPath = path.join(vaultPath, `${baseName}.md`);

  let audioWikilink: string | undefined;
  let attachedAudioPath: string | undefined;
  if (options.audioPath && fs.existsSync(options.audioPath) && retainAudio) {
    fs.mkdirSync(attachmentsDir, { recursive: true });
    attachedAudioPath = path.join(attachmentsDir, `${baseName}${audioExt}`);
    fs.copyFileSync(options.audioPath, attachedAudioPath);
    audioWikilink = `${baseName}${audioExt}`;
  }

  const body = buildMarkdown({
    ...options,
    attendees: options.attendees,
    createdISO: now.toISOString(),
    audioWikilink,
  });

  const tmp = `${mdPath}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, mdPath);

  return { markdownPath: mdPath, audioPath: attachedAudioPath };
}

/**
 * Pick a filename of the form `YYYY-MM-DD-<slug>`. If a file (Markdown or audio)
 * with that exact basename already exists in the vault or attachments folder,
 * append `-2`, `-3`, … until we find a free slot. Same suffix flows through to
 * both the .md and the audio attachment so they always agree.
 */
function resolveBasename(
  now: Date,
  title: string,
  vaultPath: string,
  attachmentsDir: string,
  audioExt: string,
): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const slug = slugify(title);
  const root = `${yyyy}-${mm}-${dd}-${slug}`;

  const isFree = (candidate: string): boolean => {
    if (fs.existsSync(path.join(vaultPath, `${candidate}.md`))) return false;
    if (audioExt && fs.existsSync(path.join(attachmentsDir, `${candidate}${audioExt}`))) return false;
    return true;
  };

  if (isFree(root)) return root;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${root}-${i}`;
    if (isFree(candidate)) return candidate;
  }
  // Astonishing fallback: 1000 collisions on the same day. Append a wall-clock
  // timestamp to guarantee uniqueness without re-introducing the random hash.
  return `${root}-${Date.now()}`;
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
  attendees?: ResolvedAttendee[];
  flagged?: string;
  audioWikilink?: string;
  recordingId?: string;
}): string {
  const attendees = (opts.attendees || []).filter((a) => a.display.trim().length > 0);

  const fm: string[] = ['---'];
  fm.push(`created: ${opts.createdISO}`);
  fm.push(`type: ${opts.type}`);
  if (opts.durationSeconds) fm.push(`duration: ${formatDuration(opts.durationSeconds)}`);
  fm.push(`source: echo`);
  if (opts.recordingId) fm.push(`recording_id: ${opts.recordingId}`);
  if (attendees.length) {
    fm.push('attendees:');
    for (const a of attendees) fm.push(`  - "${a.display.replace(/"/g, '\\"')}"`);
  }
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

  if (attendees.length) {
    out.push('## Attendees', '');
    for (const a of attendees) out.push(`- ${a.rendered}`);
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

  // User's verbatim notes — for traceability, kept distinct from the AI summary
  // and placed right before the recording artifacts (audio + transcript).
  if (opts.sections.userNotes?.trim()) {
    out.push('## My Notes', '', opts.sections.userNotes.trim(), '');
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
