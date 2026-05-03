/**
 * Capture route — quick text note path.
 *
 *   POST /capture { text: string }
 *
 * Writes a `note`-typed Markdown file to the vault inbox. Optional Claude/GPT
 * cleanup pass (title polishing) gated by the `cleanQuickNotes` setting.
 */

import { Router } from 'express';
import { writeMarkdownToVault } from '../services/obsidian-writer.js';
import { structureTranscript } from '../services/markdown-structurer.js';
import { getSettings } from '../services/settings-store.js';

export const captureRouter: Router = Router();

captureRouter.post('/capture', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });

  let title = deriveDefaultTitle(text);
  let summary = text;
  if (getSettings().cleanQuickNotes) {
    const structured = await structureTranscript(text);
    if (structured) {
      title = structured.title || title;
      summary = structured.summary || text;
    }
  }

  try {
    const result = await writeMarkdownToVault({
      title,
      type: 'note',
      sections: { summary, actionItems: [], keyPoints: [], transcript: '' },
    });
    res.status(202).json({ ok: true, path: result.markdownPath });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

function deriveDefaultTitle(text: string): string {
  const firstLine = text.split('\n')[0].trim();
  const truncated = firstLine.slice(0, 80);
  return truncated || 'Quick note';
}
