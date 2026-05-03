# Changelog

All notable changes to Echo are tracked in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Echo adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[1.0.2]: https://github.com/nilswhite/echo-app/releases/tag/v1.0.2
[1.0.1]: https://github.com/nilswhite/echo-app/releases/tag/v1.0.1
[1.0.0]: https://github.com/nilswhite/echo-app/releases/tag/v1.0.0
