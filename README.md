# Echo

A tray-resident macOS meeting recorder that pipes structured Markdown into your Obsidian vault — or any folder you choose.

Press a global hotkey, type a quick note or hit Record, and let Echo do the rest:

1. Whisper transcribes the audio (chunking automatically for long meetings)
2. Claude or GPT structures it into a title, summary, action items, and key points
3. The result lands as a Markdown file in your chosen folder, with the audio attached and wikilinked

No bots in your meetings. No board, no database, no surface to babysit. Just capture → file.

## Status

**v1.2.2.** First build worth installing — and now with attendees. The chevron-expanded section under the pill has an Attendees row that opens a popover for typing names; matched against the `.md` files in your Obsidian "People" folder, names land as `[[wikilinks]]` in the note frontmatter and an `## Attendees` section, and the structurer uses them to make a "simple diarization" pass on the transcript (`**Name:**` prefixes where the speaker is clear). See [CHANGELOG.md](CHANGELOG.md) for the full release history and the [issue backlog](_docs/issue-backlog.md) for what's coming next (ScreenCaptureKit system-audio capture, dual-track recording, real diarization).

## Install

Grab `Echo.dmg` from the [latest release](https://github.com/nilswhite/echo-app/releases) and drag **Echo.app** to Applications.

> macOS Gatekeeper will block the first launch because the build is not yet code-signed or notarized. Right-click **Echo.app → Open** the first time you run it; that's a one-time grant.

On first launch:
- Click the tray icon (echo-ripple in the menu bar)
- Open **Settings…**
- Choose your output folder, paste your OpenAI + Anthropic API keys, pick a structuring model

Then `Cmd+Shift+A` to capture.

## Develop

```bash
npm install
npm run dev
```

`tsx` loads the TypeScript directly inside the Electron main process — no build step in dev.

To build a fresh DMG:

```bash
npm run electron:make
# → out/make/Echo.dmg
```

## Architecture

```
electron/                  Electron main process + windows
  main.ts                  app lifecycle, tray, hotkey, single-instance lock
  capture.ts/.html         frameless capture window + pill mode
  capture-mic.html         floating mic picker
  settings.ts/.html        themed settings window with live model dropdowns
  tray.ts                  tray icon + menu (mic submenu, etc.)
  preload.ts               narrow IPC bridge
  theme-vars.js            shared theme system (Parchment / Electron Vue)
  mic-registry.ts          tracks audio inputs broadcasted from the renderer
  assets/                  trayTemplate.png + icon.icns

server/                    embedded Express server (port 3739)
  index.ts                 boot
  routes/
    capture.ts             POST /capture — quick text note
    recordings.ts          POST /recordings/{start,upload,stop,finalize}
  services/
    settings-store.ts      JSON-backed settings (atomic writes)
    model-catalog.ts       live model lists from /v1/models with 24h cache
    recording-store.ts     flat-file recordings.json + audio on disk
    recording-job-runner.ts  fire-and-forget pipeline orchestrator
    transcription-service.ts OpenAI Whisper + ffmpeg chunking
    markdown-structurer.ts   Anthropic / OpenAI dispatcher (provider-agnostic)
    obsidian-writer.ts       atomic Markdown drop with audio attachment

scripts/
  build-tray-icon.cjs      pure-Node PNG encoder for the tray template image
  build-app-icon.cjs       same encoder + macOS sips/iconutil → icon.icns
```

## License

[MIT](LICENSE) © 2026 Christopher White
