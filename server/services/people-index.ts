/**
 * People index — resolve attendee names against `.md` notes in the user's
 * Obsidian People folder.
 *
 * The People folder is either the explicit `peoplePath` setting or auto-detected
 * (`<vaultPath>/People` first, then a `People` sibling of `vaultPath`). Shallow
 * scan only — nested subfolders are intentionally ignored to keep matching
 * predictable.
 *
 * Matching is permissive but conservative: exact filename hit (case-insensitive)
 * wins; otherwise an unambiguous prefix match (one and only one person whose
 * name starts with the input) wins; otherwise no match. We never fuzzy-match
 * across multiple candidates — silently linking the wrong person is worse than
 * leaving the name as plain text.
 */

import fs from 'fs';
import path from 'path';
import { getSettings } from './settings-store.js';

export interface PersonRef {
  /** Filename without extension — the canonical name to display. */
  name: string;
  /** Absolute path to the .md file. Useful for diagnostics; not currently used by callers. */
  filePath: string;
}

export interface ResolvedAttendee {
  /** What the user typed. */
  raw: string;
  /** Match against the People folder, if any. */
  matched: PersonRef | null;
  /** What to render: matched name (canonical spelling) or the raw input. */
  display: string;
  /** Obsidian wikilink form (`[[Name]]`) when matched, plain text when not. */
  rendered: string;
}

interface CacheEntry {
  dir: string;
  mtimeMs: number;
  refs: PersonRef[];
}

let cache: CacheEntry | null = null;

export function resolvePeopleDirectory(): string {
  const { peoplePath, vaultPath } = getSettings();
  if (peoplePath) return peoplePath;
  if (!vaultPath) return '';
  const candidates = [
    path.join(vaultPath, 'People'),
    path.join(path.dirname(vaultPath), 'People'),
  ];
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isDirectory()) return c;
    } catch { /* not a directory, try next */ }
  }
  return '';
}

export function getPeopleIndex(): PersonRef[] {
  const dir = resolvePeopleDirectory();
  if (!dir) return [];
  let stat: fs.Stats;
  try { stat = fs.statSync(dir); } catch { return []; }
  if (!stat.isDirectory()) return [];

  if (cache && cache.dir === dir && cache.mtimeMs === stat.mtimeMs) {
    return cache.refs;
  }

  const refs: PersonRef[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.toLowerCase().endsWith('.md')) continue;
      const name = entry.name.replace(/\.md$/i, '');
      refs.push({ name, filePath: path.join(dir, entry.name) });
    }
  } catch { /* ignore unreadable dirs */ }

  cache = { dir, mtimeMs: stat.mtimeMs, refs };
  return refs;
}

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function resolveAttendees(rawNames: string[]): ResolvedAttendee[] {
  const refs = getPeopleIndex();
  const byNorm = new Map<string, PersonRef>();
  for (const r of refs) byNorm.set(normalize(r.name), r);

  return rawNames
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw): ResolvedAttendee => {
      const key = normalize(raw);
      const exact = byNorm.get(key);
      if (exact) return makeResolved(raw, exact);

      // Unambiguous prefix match (e.g., user typed "Alice" and exactly one People
      // file starts with "Alice "). Avoids false positives when two people share
      // a first name.
      const prefixCandidates = refs.filter((r) => normalize(r.name).startsWith(key + ' '));
      if (prefixCandidates.length === 1) return makeResolved(raw, prefixCandidates[0]);

      return { raw, matched: null, display: raw, rendered: raw };
    });
}

function makeResolved(raw: string, ref: PersonRef): ResolvedAttendee {
  return {
    raw,
    matched: ref,
    display: ref.name,
    rendered: `[[${ref.name}]]`,
  };
}
