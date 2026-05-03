# Echo MVP — Implementation Plan

**Overall Progress:** `100%` (code-complete; user-facing smoke tests with real API keys + DMG build pending)

## TLDR

Echo is a tray-resident macOS Electron app: press a global hotkey, record a meeting (or type a quick note), and a structured Markdown file lands in your Obsidian vault inbox. We're forking the recording stack out of Strata, throwing away everything Strata-specific (board, signals, SQLite, MCP, React app surface), and pointing the output at the filesystem instead of a database.

Source app: `/Users/christopherwhite/Developer/Strata` (v4.5.3). Spec lives in Strata's `_docs/issue-backlog.md` as **ID-150**.

## Critical Decisions

- **Mic-only for v0.1, no system audio.** Strata's shipped recording uses `getUserMedia` (mic only); the ScreenCaptureKit work in ID-143 was never built. Echo inherits the same limitation. System audio is a v0.2 feature.
- **No SQLite.** Recording metadata persists as a flat `recordings.json` in `userData/`. Settings as `settings.json`. No `better-sqlite3`, no migrations.
- **Output target = filesystem.** Files written to `<vault>/0_Inbox/<basename>.md`, audio to `<vault>/0_Inbox/_attachments/<basename>.<ext>`, linked via Obsidian wikilink. Atomic writes (temp + rename).
- **Vault access via folder picker.** macOS sandboxing restricts arbitrary writes; first-launch picker grants persistent access via security-scoped bookmark instead of requiring full disk access.
- **Filename: `YYYY-MM-DD-HHmm-<slug>.md`** with a 4-char hash suffix to avoid same-minute collisions.
- **Transcription = OpenAI Whisper** (carry over Strata's `transcription-service.ts` with chunking + hallucination filter intact).
- **Structuring = Anthropic OR OpenAI, user-selectable.** Settings window (opened from the tray) has a provider dropdown + a model dropdown that updates based on the chosen provider. Default: Anthropic + `claude-sonnet-4-6`. Single-pass prompt returns title + summary + action items + key points.
- **Model list is live, fetched from each provider's `/v1/models` API** — never hard-coded. Anthropic: `GET https://api.anthropic.com/v1/models` (returns Claude models for the key). OpenAI: `GET https://api.openai.com/v1/models` (returns everything; filtered to chat-capable models — id starts with `gpt-`, `o1`, `o3`, or `o4`, excluding embeddings/tts/whisper/audio/realtime/instruct/dall-e variants). Results cached in `userData/model-cache.json` for 24h with a "Refresh models" button in Settings to force-revalidate. If a fetch fails (no key, offline, 4xx), fall back to a tiny built-in default list so the dropdown is never empty.
- **No React, no main window.** Capture window is the only UI surface. Settings is a minimal HTML form. The whole `src/` tree from Strata is dropped.
- **Embedded Express server.** Same pattern as Strata (Electron main spawns Express on a local port) — keeps the recording pipeline fire-and-forget so the user can close the capture window mid-transcription without losing the job.
- **Failure resilience.** If transcription fails, write a flagged Markdown stub with the error in frontmatter and a wikilink to the audio — the user always sees a trace in their inbox.

## Tasks

- [x] 🟩 **Step 1: Scaffold project + tooling**
  - [x] 🟩 `git init` + `.gitignore` (node_modules, dist, out, electron-dist, *.db*, userData artifacts)
  - [x] 🟩 `package.json` with minimal deps: `electron`, `express`, `multer`, `openai`, `@anthropic-ai/sdk`, `ffmpeg-static`, `tsx`, `typescript`, `concurrently`, `@electron-forge/*`
  - [x] 🟩 `tsconfig.json` (ES2022, NodeNext, strict)
  - [x] 🟩 `forge.config.ts` cribbed from Strata; productName "Echo", bundle id `com.christopherwhite.echo`, ffmpeg-static unpack rule preserved
  - [x] 🟩 `README.md` stub
  - [x] 🟩 `npm install` + verify `electron` boots an empty BrowserWindow

- [x] 🟩 **Step 2: Settings store + window**
  - [x] 🟩 `server/services/settings-store.ts` — JSON file in `app.getPath('userData')`, fields: `vaultPath`, `inboxFolder` (default `0_Inbox`), `openaiKey`, `anthropicKey`, `structuringProvider` (`anthropic` | `openai`, default `anthropic`), `structuringModel` (default `claude-sonnet-4-6`), `hotkey` (default `CommandOrControl+Shift+A`), `retainAudio` (default `true`), `cleanQuickNotes` (default `false`)
  - [x] 🟩 `server/services/model-catalog.ts` — fetches live model lists from `https://api.anthropic.com/v1/models` (header `x-api-key` + `anthropic-version: 2023-06-01`) and `https://api.openai.com/v1/models` (bearer auth); filters OpenAI list to chat-capable ids; caches both in `userData/model-cache.json` with 24h TTL; `refreshModels()` forces revalidation; built-in fallback list if a fetch errors so the UI never breaks
  - [x] 🟩 `electron/settings.html` — single form: vault picker, OpenAI key, Anthropic key, **provider dropdown** (Anthropic / OpenAI), **model dropdown** populated from the catalog for the active provider, "Refresh models" button next to the model dropdown, retain-audio toggle, hotkey field
  - [x] 🟩 `electron/settings.ts` — BrowserWindow + IPC handlers (`settings:read`, `settings:write`, `settings:pick-vault`, `settings:list-models`, `settings:refresh-models`); validates `structuringModel` belongs to the chosen provider's catalog on save
  - [x] 🟩 Tray menu item "Settings…" opens the window

- [x] 🟩 **Step 3: Tray + global hotkey + capture window shell**
  - [x] 🟩 `electron/entry.cjs` (CommonJS entrypoint that loads compiled main)
  - [x] 🟩 `electron/main.ts` — app lifecycle, no main window, registers global hotkey from settings (Express spawn lands in Step 4)
  - [x] 🟩 `electron/tray.ts` — tray icon + menu (Capture, Settings, Reveal Vault, Quit)
  - [x] 🟩 `electron/preload.ts` — context-isolated bridge exposing `capture:*` IPC
  - [x] 🟩 Port `electron/capture.ts` from Strata; stripped `capture:submit` Strata routes (cards/ideas), kept recording + pill-mode + mic-picker IPC, capture window posts to `/api/capture` and `/api/recordings/*`
  - [x] 🟩 Port `electron/capture.html` from Strata; removed Action/Idea type toggle and image attach, kept Record + mic picker + pill mode + level meter + silence warning
  - [x] 🟩 Port `electron/capture-mic.html` (mic preference now lives in renderer localStorage, not Strata's settings API)
  - [x] 🟩 Boot verified — main process + helpers run, hotkey registers without errors

- [x] 🟩 **Step 4: Recording → file persistence (no transcription yet)**
  - [x] 🟩 `server/services/recording-store.ts` — flat-file rewrite: audio in `userData/recordings/<id>.<ext>`, metadata in `userData/recordings.json`
  - [x] 🟩 `server/routes/recordings.ts` — slim endpoints: `POST /recordings/start`, `POST /recordings/:id/upload`, `POST /recordings/:id/stop`, `POST /recordings/:id/finalize`, `GET /recordings/:id/job-status`
  - [x] 🟩 `server/index.ts` — Express bootstrap on `127.0.0.1:3739`, wires routes
  - [x] 🟩 End-to-end curl test: start → upload → stop → finalize produces audio on disk + persisted metadata

- [x] 🟩 **Step 5: Transcription pipeline**
  - [x] 🟩 Port `server/services/transcription-service.ts` from Strata verbatim (dropped unused `getAnthropicKey` import, repointed `getOpenAIKey` to Echo's settings-store)
  - [x] 🟩 `server/services/recording-job-runner.ts` — slimmed (~120 LOC): in-memory job map, no SSE, no SQLite, no classification, no orphan resume; transcribe → write
  - [x] 🟩 Wire `recordings.ts` finalize handler to kick off the job
  - [ ] 🟨 Verify with a real 30s recording (needs OpenAI key + actual mic capture — pending user test)
  - [ ] 🟨 Verify chunking with a >25 MB / >50 min recording (pending real long recording)

- [x] 🟩 **Step 6: Claude/OpenAI structuring + Obsidian writer**
  - [x] 🟩 `server/services/markdown-structurer.ts` — provider-agnostic single call, dispatches to Anthropic SDK or OpenAI Responses API based on `structuringProvider`, uses `structuringModel`, returns `{ title, summary, actionItems[], keyPoints[] }`; prompt-cached system prompt (Anthropic `cache_control: ephemeral`) / `prompt_cache_key` (OpenAI Responses API)
  - [x] 🟩 `server/services/obsidian-writer.ts` — builds Markdown body with frontmatter (`created`, `type`, `duration`, `source`, `recording_id`); writes to `<vault>/<inboxFolder>/` atomically (`.tmp` + rename); copies audio to `_attachments/`; adds Obsidian wikilink; honors `retainAudio` toggle; collision-safe filename via 4-char hash
  - [x] 🟩 Structurer + writer wired into the job runner; structuring failure falls back to raw-transcript stub instead of crashing
  - [ ] 🟨 End-to-end verification (real record → vault file) pending user test with API keys configured

- [x] 🟩 **Step 7: Quick text note path**
  - [x] 🟩 `server/routes/capture.ts` — `POST /capture` accepts `{ text }` for the no-recording case
  - [x] 🟩 Capture window: pressing Enter without recording posts text and writes a `note`-typed `.md`
  - [x] 🟩 Optional Claude/GPT title+summary cleanup pass gated by `cleanQuickNotes` setting
  - [x] 🟩 Verified end-to-end: posted text to /api/capture → `.md` landed in test vault with correct frontmatter (`type: note`, `source: echo`) and slugified filename + hash suffix

- [x] 🟩 **Step 8: Failure resilience**
  - [x] 🟩 On transcription error, write a flagged `.md` stub with `status: error` + `error: <message>` in frontmatter, a `> [!warning]` callout, and the audio wikilink — applied to silence, hallucination, transcription failure, and structuring failure paths
  - [ ] 🟨 Surface error state back to the capture window — deferred. The capture window dismisses immediately after finalize (fire-and-forget); the flagged stub in the vault inbox is the surface, matching ID-150's design intent. Revisit if the inbox surface proves insufficient.
  - [x] 🟩 Verified: bad OpenAI key + bogus audio → 401 captured, flagged `.md` lands in vault with audio preserved in `_attachments/`

- [x] 🟩 **Step 9: Polish + packaging**
  - [x] 🟩 Hotkey customization wired to settings + re-registered live (no restart) via a `onSettingsChanged` listener in `main.ts` that unregisters the old accelerator and re-registers the new one, plus rebuilds the tray menu accelerator label
  - [x] 🟩 Pill mode position persistence verified — `capture.ts` writes `capture-pill-bounds.json` on pill-exit and reloads it on next pill-enter
  - [x] 🟩 Tray "Reveal Vault Inbox" opens the inbox folder in Finder via `shell.openPath` (with a friendly dialog if no vault is configured yet)
  - [x] 🟩 `forge.config.ts` set up to NOT strip TS sources — `tsx` ships as a runtime dep and `electron/entry.cjs` loads TS directly, no precompile step needed for v0.1
  - [ ] 🟨 `npm run electron:make` actual `.dmg` build + clean-account smoke test pending user run (heavy long-running operation; everything is wired to make it work)
