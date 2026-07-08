/**
 * Settings store — JSON-backed config persisted to userData/settings.json.
 *
 * Writes are atomic (temp file + rename) so a crash mid-save can't corrupt the file.
 * All reads go through `getSettings()` which returns a fresh copy with defaults applied.
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export type StructuringProvider = 'anthropic' | 'openai';
export type ThemeMode = 'system' | 'light' | 'dark';

export interface Settings {
  vaultPath: string;
  openaiKey: string;
  anthropicKey: string;
  structuringProvider: StructuringProvider;
  structuringModel: string;
  hotkey: string;
  retainAudio: boolean;
  cleanQuickNotes: boolean;
  preferredMicId: string;
  preferredMicLabel: string;
  themeMode: ThemeMode;
  /**
   * Folder where the user's "People" notes live (one note per person, filename = name).
   * Used to resolve attendee names to `[[wikilinks]]` and to give the structurer the
   * canonical spelling. Empty string = auto-detect (try <vaultPath>/People, then a
   * People sibling of vaultPath); set explicitly to disable auto-detect.
   */
  peoplePath: string;
}

const DEFAULTS: Settings = {
  vaultPath: '',
  openaiKey: '',
  anthropicKey: '',
  structuringProvider: 'anthropic',
  structuringModel: 'claude-sonnet-4-6',
  hotkey: 'CommandOrControl+Shift+A',
  retainAudio: true,
  cleanQuickNotes: false,
  preferredMicId: '',
  preferredMicLabel: '',
  themeMode: 'system',
  peoplePath: '',
};

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

let cached: Settings | null = null;

export function getSettings(): Settings {
  if (cached) return { ...cached };
  try {
    const raw = fs.readFileSync(settingsPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Settings>;
    cached = { ...DEFAULTS, ...parsed };
  } catch {
    cached = { ...DEFAULTS };
  }
  return { ...cached };
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const current = getSettings();
  const next = { ...current, ...patch };
  const file = settingsPath();
  const tmp = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, file);
  cached = next;
  return { ...next };
}

export function getOpenAIKey(): string {
  return getSettings().openaiKey || process.env.OPENAI_API_KEY || '';
}

export function getAnthropicKey(): string {
  return getSettings().anthropicKey || process.env.ANTHROPIC_API_KEY || '';
}
