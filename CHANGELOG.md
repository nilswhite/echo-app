# Changelog

All notable changes to Echo are tracked in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Echo adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.2] — 2026-05-11

### Fixed
- **Mission Control / Spotlight / Cmd+Tab / Space switches ended recordings** — the capture renderer had a `visibilitychange` listener that stopped the MediaRecorder whenever `document.visibilityState` flipped to `hidden`. macOS fires that event for any Space-level interaction (Mission Control swipe, Spotlight, switching desktops, Stage Manager), so a swipe-up during a meeting silently ended the recording and shipped a partial note into the inbox. Removed the visibility-stop entirely; only the Stop button or app quit will end a recording now. The `beforeunload` cleanup still releases the mic stream on actual window destruction so coreaudiod doesn't end up holding a stuck device reference.
- **Esc on the expanded title input no longer cancels a recording in progress** — pressing Esc while the full window was visible during a recording used to hide the window (which, via the visibility-stop bug above, ended the recording). Now Esc during recording collapses back to the pill instead, preserving the recording UI.

## [1.2.1] — 2026-05-09

### Changed
- **Non-diarized transcription upgraded `whisper-1` → `gpt-4o-transcribe`** — same per-minute price, materially better accuracy on accented speech, noisy audio, and overlapping voices. The legacy Whisper V2 path was getting noticeably worse on real-world meeting audio relative to the GPT-4o-based replacement. Diarized recordings (when attendees are set) continue to use `gpt-4o-transcribe-diarize`.

### Fixed
- **Diarized recordings >30s could be silently truncated** — `gpt-4o-transcribe-diarize` requires `chunking_strategy` for inputs longer than 30 seconds, and we weren't passing it. Added `chunking_strategy: 'auto'` so the API uses server-side VAD-based segmentation. Without this, anything past the first ~30 seconds of a long meeting may have been dropped from the diarized transcript.

## [1.2.0] — 2026-05-09

### Added
- **Real diarized transcription** — when attendees are listed for a recording, Echo now routes transcription through OpenAI's `gpt-4o-transcribe-diarize` model instead of `whisper-1`. The model returns the transcript pre-segmented by speaker (labeled `A`, `B`, `C`, …); the structurer then maps those labels to attendee names from context and the markdown renders as `**Alice Chen:** …` / `**You:** …` paragraphs. No attendees → unchanged Whisper path. Replaces the prompt-engineered "simple diarization" attempt that ran on flat text.
- **Schema-enforced structuring (Anthropic structured outputs)** — the structurer now uses `client.messages.parse({ output_config: { format: jsonSchemaOutputFormat(…) } })` so the model's output is API-enforced against a JSON Schema. Eliminates the "model emitted broken JSON, parse failed silently, the title and summary are gone" failure mode entirely. OpenAI structuring also moved to schema-enforced mode via the Responses API's `text.format = { type: 'json_schema', … }`.

### Changed
- **SDK bumps** — `@anthropic-ai/sdk` 0.78.0 → 0.95.1, `openai` 6.25.0 → 6.37.0. Drop-in compatible at every existing call site.
- **Multi-chunk diarized recordings** prefix per-chunk speaker labels with the chunk index (e.g. `1A`, `2B`) so the structurer can disambiguate speakers across chunk boundaries — chunk-1 "A" and chunk-2 "A" are independent labels from the model's perspective.
- **Structurer pipeline simplified** — the separate "attribute transcript" call introduced in 1.1.1 is gone. Diarization comes from the transcription model; speaker mapping is part of the single structuring call. One API round-trip instead of two when attendees are set.

## [1.1.1] — 2026-05-06

### Fixed
- **Mic picker and attendees popover snapped to primary monitor** — when the recording pill lived on a secondary display (especially one positioned to the left of primary, where coordinates are negative), both popovers would open on the primary display. The bounds calc used `Math.max(0, …)`, which clamped to the global origin instead of the pill's display. Now both popovers clamp to the work area of the display containing the pill.
- **Structuring silently failed on long meetings** — the structurer asked the model to emit a single JSON object that included the entire transcript as `attributedTranscript`. With `max_tokens: 4096`, transcripts longer than ~3000 tokens truncated mid-string, JSON parsing failed, and the title/summary/action items were lost as collateral damage (only the raw transcript survived in a flagged "structuring failed" stub). Split into two independent calls: a small-output structuring call for the JSON fields, and a separate large-output (32K Claude / 16K OpenAI) attribution pass that runs in parallel. If attribution fails or truncates, structuring still succeeds and the note falls back to the raw transcript. Also surfaced the underlying parse/API errors instead of swallowing them.

## [1.1.0] — 2026-05-04

### Added
- **Attendees on a recording** — the chevron-expanded section under the pill now has an "Attendees" row alongside the title row. Clicking the button opens a popover (separate frameless window, mirrors the mic-picker pattern) with a multi-line textarea (one name per line) and a remove-rows convenience list. Names persist for the recording and ride along in the finalize payload.
- **People-folder name resolution** — attendee names are matched against `.md` filenames in your Obsidian "People" folder (case-insensitive, with an unambiguous-prefix fallback so "Alice" resolves to `Alice Chen.md` when there's only one Alice). Matched names land as `[[wikilinks]]` in both the frontmatter and a new `## Attendees` section in the body. The People folder is auto-detected as `<vaultPath>/People` (or a sibling of `vaultPath`); you can override the path in Settings.
- **Simple diarization attempt** — when attendees are provided, the structurer is asked to emit an `attributedTranscript` field with `**Name:**` / `**You:**` prefixes inserted where the speaker is reasonably clear from context. Falls back to the raw transcript when the model leaves a line ambiguous or no attendees were given. Naturally limited by Echo's mic-only capture (ID-001 will fix that); useful right now for in-person meetings where the laptop mic catches the whole room.

### Changed
- `PILL_HEIGHT_WITH_TITLE` grew from 90 → 128 to accommodate the new attendees row.

## [1.0.3] — 2026-05-04

### Fixed
- **Mic picker stuck in light mode** — `settings.ts` only broadcast `theme:apply` to the capture window and Settings window, never to the mic picker. The picker now receives the broadcast and re-themes alongside the rest of the UI.

### Added
- **Mic switching mid-recording** — the pill's mic icon is now a clickable picker (not just a status indicator), and selecting a different device while a recording is in progress hot-swaps the input without restarting the recorder. Internally the recording graph is now `MediaStreamSource → analyser + MediaStreamAudioDestinationNode`, with the `MediaRecorder` reading from the destination node so the input source can be swapped on the fly.

## [1.0.2] — 2026-05-03

### Changed
- **Filename pattern simplified** — was `YYYY-MM-DD-HHmm-<slug>-<4charhash>.md`, now `YYYY-MM-DD-<slug>.md`. The time and the random 4-char collision hash are gone; on the rare same-day same-slug collision Echo just appends `-2`, `-3`, etc. Audio attachments use the same resolved basename so the `.md` and the `_attachments/<basename>.<ext>` always agree.

## [1.0.1] — 2026-05-02

### Fixed
- **Packaged app crashed silently on launch** — `entry.cjs`'s dev-mode fallback ran `tsx` at runtime in the packaged build, and tsx pulls in `esbuild`, which spawns a native helper binary from `node_modules/@esbuild/...`. asar archives aren't real directories, so `child_process.spawn` failed with `ENOTDIR` and the entire app died — process alive, but no tray, no server, no whenReady. Fix: precompile `electron/main.ts` (and everything it imports) into `electron-dist/main.cjs` via a build-time esbuild bundle. `entry.cjs` already prefers the bundle when present, so the packaged app is now pure JS at runtime — no tsx, no esbuild involvement after build time.
- **Dock icon flashed at launch** — without `LSUIElement: true` in `Info.plist`, macOS would briefly show an Echo icon in the Dock before `app.dock.hide()` ran. Set `extendInfo.LSUIElement = true` in `forge.config.ts`. Echo is now a true tray-only app from the moment it launches.

### Added
- `scripts/build-electron.cjs` — esbuild bundler for the main process bundle
- `npm run build:electron` script; wired into `electron:make`, `electron:package`, and `electron:start` so all packaged paths use the precompiled bundle
- `npm run dev` is unchanged and still uses tsx for fast iteration

## [1.0.0] — 2026-05-02

First shippable release. Tray-resident macOS app that records meetings (or quick text notes) via global hotkey, transcribes them with OpenAI Whisper, structures the result with Claude or GPT, and drops a Markdown file directly into a folder of your choosing — designed for piping into an Obsidian vault inbox, but works with any folder.

### Added
- **Tray-resident lifecycle** — no main window; menu-bar icon + global hotkey (`Cmd+Shift+A` by default, configurable) is the only persistent UI
- **Single-instance lock** so a second Electron process can never race the first one for the microphone
- **Capture window** — frameless, always-on-top, multi-line textarea that fills the available space and scrolls vertically. `Enter` saves a quick note; `Shift+Enter` inserts a newline; `Esc` dismisses
- **Recording pill** — pressing Record collapses the window to a Granola-style 192×52 floating pill that drags anywhere on screen and remembers its last position. Live mic level meter, silence-detection warning, recording duration counter
- **Pill title input** — a thin chevron strip below the pill expands a title row where you can type a meeting title mid-recording. The typed title overrides the AI-generated one in the final note
- **Minimize-to-pill button** — top-right corner of the full window, only visible during an active recording; click returns to the pill without stopping the recording
- **Mic device selection** — submenu in the tray icon lists every audio input device with a checkmark on the active one, plus an in-window picker. Selection persists in `settings.json`
- **Embedded Express server** on `127.0.0.1:3739`, fire-and-forget pipeline so closing the capture window never loses an in-flight transcription
- **OpenAI Whisper transcription** with `ffmpeg-static`-based chunking for files over the 25 MB API limit, plus a hallucination filter for silence-induced false transcripts
- **Provider-agnostic structuring** — choose Anthropic Claude or OpenAI GPT in Settings; the model dropdown is fetched live from each provider's `/v1/models` API and cached for 24h with a manual refresh button
- **Atomic Markdown writes** — temp file + rename, so iCloud Drive / Obsidian Sync never sees a partial file. Filename pattern `YYYY-MM-DD-HHmm-<slug>-<hash>.md`
- **Audio attachments** — when the "Keep audio" toggle is on, the original recording is copied to `_attachments/` next to the Markdown file with an Obsidian wikilink in the body
- **Failure resilience** — any transcription error writes a flagged Markdown stub with `status: error` in the frontmatter, a `> [!warning]` callout, and the audio preserved so nothing is lost silently
- **Theme system** — Light (Strata's *Parchment*), Dark (Strata's *Electron Vue*), or System. Three-icon toggle in the Settings titlebar; capture window, pill, mic picker, and Settings all respond to the choice in real time
- **Quick-text-note path** — `Cmd+Shift+A`, type, `Enter` saves a Markdown file with no transcript section. Optional Claude/GPT cleanup pass via the `cleanQuickNotes` toggle
- **Tray menu** — Capture, Microphone submenu, Settings, Reveal Output Folder, Quit Echo
- **Hand-rasterized icons** — `trayTemplate.png` (template image, auto-tinted by macOS menu bar) and `icon.icns` (full-color squircle for the dock), both built by zero-dependency PNG encoders in `scripts/`
- **electron-forge build** — `npm run electron:make` produces a working `.dmg` (~138 MB) with `ffmpeg-static` correctly placed in `app.asar.unpacked/` so the binary is executable in the packaged app
- **MIT license**

### Known limitations
- **macOS arm64 only** — no Intel build target configured (easy to add)
- **Not code-signed or notarized** — first launch requires right-click → Open to bypass Gatekeeper
- **Mic only, no system audio** — meetings record only your local mic, not the remote participants' audio. Tracking via [issue ID-001](_docs/issue-backlog.md) for v1.1+
- **No speaker diarization** — single-speaker transcripts. Tracking via ID-003
- **No auto-update** — reinstall the DMG to upgrade

### Provenance
Forked architecturally from Strata (a private companion app) — the recording pipeline, capture window, pill UX, and theme variables were ported verbatim where they were already battle-tested. ID-150 in Strata's own backlog originally specified this derivative.

[1.2.2]: https://github.com/nilswhite/echo-app/releases/tag/v1.2.2
[1.2.1]: https://github.com/nilswhite/echo-app/releases/tag/v1.2.1
[1.2.0]: https://github.com/nilswhite/echo-app/releases/tag/v1.2.0
[1.1.1]: https://github.com/nilswhite/echo-app/releases/tag/v1.1.1
[1.1.0]: https://github.com/nilswhite/echo-app/releases/tag/v1.1.0
[1.0.3]: https://github.com/nilswhite/echo-app/releases/tag/v1.0.3
[1.0.2]: https://github.com/nilswhite/echo-app/releases/tag/v1.0.2
[1.0.1]: https://github.com/nilswhite/echo-app/releases/tag/v1.0.1
[1.0.0]: https://github.com/nilswhite/echo-app/releases/tag/v1.0.0
