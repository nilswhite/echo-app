# Agent Handoff

_Last updated: 2026-07-08. Snapshot of repo state for a fresh agent._

## Project State Summary

- Echo is a tray-resident macOS meeting recorder (Electron + local Express server). Shipped MVP is v1.0.2; CHANGELOG describes through v1.2.2.
- **Branch `feature/user-notes-and-reliability`** is committed and pushed (3 commits ahead of `origin/main`, 0 behind). Working tree clean. No PR opened yet.
- **ID-005 "User Notes" — DONE, verified, closed 2026-06-20.** A single **Notes** button on the recording pill (attendee-count badge) expands the pill in place into a portrait window: title + attendees + free-form "Your notes" inline, pill controls (mic, volume bars, timer, stop, expand) pinned on top. Old attendees popover deleted; attendee parsing + People-folder resolution run inline in `capture.html`.
- Notes flow end-to-end: finalize POST → store (`Recording.userNotes`) → job runner → structurer (HIGH-PRIORITY `User notes:` block) → `obsidian-writer` writes verbatim `## My Notes` before `## Transcript`, on every job path.
- **ID-006 (closed 2026-06-17):** Mission Control killed recordings; fixed with `backgroundThrottling: false` on the capture window (Web Audio `AudioContext` suspended when occluded).
- **Transcription duration-chunking fix (this session, 2026-07-08):** long-but-small recordings (low-bitrate Opus stays under the 25 MB size gate at 90+ min) were sent as a single request and failed — flat model "request timed out", diarize model "exceeded the 1400s model cap". Chunking now triggers on duration (>1200s) as well as file size, reusing the existing 300s ffmpeg chunk path.

## Key Files Touched

- `server/services/transcription-service.ts` — `SINGLE_REQUEST_DURATION_LIMIT = 1200`, `TranscriptionOptions.durationSeconds`, duration-OR-size chunking gate
- `server/services/recording-job-runner.ts` — threads `rec.durationSeconds` into `transcribeAudio`
- `electron/capture.ts` — pill/notes window sizing, `capture:notes-toggle` stepped tween, `backgroundThrottling:false`
- `electron/capture.html` — pill Notes button, inline notes panel, attendee resolution
- `electron/preload.ts` / `preload.js` — `toggleNotes`, `resolveAttendees`
- `electron/settings.ts` — removed `getCaptureAttendeesWindow` theme-broadcast hook
- `server/routes/recordings.ts`, `server/services/recording-store.ts`, `server/services/markdown-structurer.ts`, `server/services/obsidian-writer.ts`
- Deleted: `electron/capture-attendees.html`
- Docs: `_docs/issue-backlog.md`, `_docs/development-tracker.md`, `_docs/agent-handoff.md`

## Outstanding Work / Next Focus

- **Verify transcription fix end-to-end:** needs a real >20-min recording + API key (flat and diarized paths) → confirm chunking engages and no timeout / 1400s-cap error.
- **Optional recovery path:** recently-failed recordings preserved their audio on disk but there's no re-transcribe UI. A one-off "reprocess `rec_…`" script/button would recover them through the fixed pipeline.
- **ID-007 (planned, not started):** recording durability — stream audio + notes to disk during capture, recover orphans on launch. Plan in `_docs/plans/id-007-durability.md`.
- **Backlog (ordered, each depends on the prior):** ID-001 system audio → ID-002 dual-track → ID-003 diarization → ID-004 presenting-mode.
- **PR:** branch is pushed; open a PR when ready (`gh pr create`) — GitHub offered the URL on push.

## Testing Notes

- Build loop: `node scripts/build-electron.cjs` (esbuild bundle, exit 0) → `npm run electron:make` (DMG at `out/make/Echo.dmg`).
- Latest DMG built 2026-07-08 09:24, 140 MB, includes the transcription fix.
- `tsc --noEmit` adds **no new** errors over baseline (2 pre-existing: `electron/main.ts:78`, `server/routes/recordings.ts:40`). App ships via esbuild/tsx (no typecheck gate) — don't block on `tsc`.
- Still needs a human (GUI + mic + API key): long-recording transcription chunking; ID-005 record→notes→Stop→`.md` has `## My Notes` + AI summary reflects notes; ID-006 Mission Control persistence.
- `npm run dev` (`ELECTRON=1 electron .`) runs without a fresh `build:electron`.

## Git Notes

- On `feature/user-notes-and-reliability`, pushed to origin, working tree clean.
- **Repo git email set to `5048191+nilswhite@users.noreply.github.com`** (repo-local config only, global untouched) — GitHub blocks pushing the private gmail. New commits here use the noreply address automatically.
- The 3 branch commits were re-authored to the noreply email to satisfy GitHub's push protection.
- `out/` and `electron-dist/` are build output — gitignored, do not commit.
