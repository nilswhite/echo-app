# Agent Handoff

_Last updated: 2026-06-20. Snapshot of repo state for a fresh agent._

## Project State Summary

- Echo is a tray-resident macOS meeting recorder (Electron + local Express server). Released MVP is v1.0.2.
- **In flight (uncommitted):** ID-005 "User Notes" feature and ID-006 reliability fix. Nothing committed yet — all changes are working-tree only.
- **ID-005 (Concept B) — implemented, awaiting visual sign-off:** a single **Notes** button on the recording pill (shows attendee-count badge) expands the pill in place into a portrait window; title + attendees + free-form "Your notes" inline, pill controls (mic, volume bars, timer, stop, expand) pinned on top.
- The separate attendees popover (`capture-attendees.html`, `captureAttendeesWindow`, its IPC) was **deleted**; attendee parsing + People-folder resolution now run inline in `capture.html`.
- Notes flow end-to-end: finalize POST → store (`Recording.userNotes`) → job runner → structurer (HIGH-PRIORITY `User notes:` block) → `obsidian-writer` writes verbatim `## My Notes` before `## Transcript`, on every job path.
- **Open/close animation:** the **main process steps the window bounds** (`capture:notes-toggle` in `electron/capture.ts`), constant width (portrait = pill width 252px), height-only, easeInOutCubic, 18 steps. This was the v4 fix after native-resize / clip-path / width-animation attempts each showed artifacts (drag-over-pill, snap, ghost, bump, jiggle).
- **ID-006 (Closed 2026-06-17):** Mission Control was killing recordings; fixed with `backgroundThrottling: false` on the capture window (Web Audio `AudioContext` was suspended when occluded).

## Key Files Touched

- `electron/capture.ts` — pill/notes window sizing, `capture:notes-toggle` stepped tween, `backgroundThrottling:false`, removed popover window + `pill-title-toggle`
- `electron/capture.html` — pill Notes button, inline notes panel, attendee resolution, open/close JS
- `electron/preload.ts`, `electron/preload.js` — collapsed to `toggleNotes` (+ `resolveAttendees`)
- `electron/settings.ts` — removed `getCaptureAttendeesWindow` theme-broadcast hook
- `server/routes/recordings.ts`, `server/services/recording-store.ts`, `server/services/recording-job-runner.ts`
- `server/services/markdown-structurer.ts`, `server/services/obsidian-writer.ts`
- Deleted: `electron/capture-attendees.html`
- Docs: `_docs/issue-backlog.md`, `_docs/development-tracker.md`, `_docs/plans/id-007-durability.md`
- Playgrounds (untracked): `_playground/user-notes-playground.html`

## Outstanding Work / Next Focus

- **ID-005 sign-off:** confirm the v4 close transition (no ghost/bump/jiggle) on the latest DMG; then commit ID-005 + ID-006 together on a branch.
- **Open decision:** portrait width — keep 252px (matches pill, current) or widen both pill + portrait to 300px (roomier, the playground look).
- **ID-007 (planned, not started):** recording durability — stream audio + notes to disk during capture, recover orphans on launch. Full plan in `_docs/plans/id-007-durability.md`.
- **Backlog:** ID-001 system audio → ID-002 dual-track → ID-003 diarization → ID-004 presenting-mode (ordered; each depends on the prior).

## Testing Notes

- Build loop: `node scripts/build-electron.cjs` (esbuild bundle) → `npm run electron:make` (DMG at `out/make/Echo.dmg`).
- Verified each iteration: bundle builds exit 0; inline HTML scripts parse; `tsc --noEmit` adds **no new** errors over baseline (3 pre-existing: `main.ts:78`, `recordings.ts:40`, `people-index.ts:48`).
- Animation debugging used ffmpeg frame-stepping of screen recordings (project ships `node_modules/ffmpeg-static/ffmpeg`).
- Still needs a human (GUI + mic + API key): end-to-end record → notes mid-recording → Stop → `.md` has `## My Notes` + AI summary reflects notes; ID-006 Mission Control persistence; window edge-clamping near a display edge.
- `npm run dev` (`ELECTRON=1 electron .`) runs without a fresh `build:electron`; `electron:start` builds first.

## Git Notes

- Branch `main`, nothing committed this session. Commit ID-005 + ID-006 on a feature branch (not directly to main).
- Modified but **incidental / pre-existing** (not part of this work — confirm before staging): `CHANGELOG.md`, `README.md`, `package.json`, `package-lock.json`, `electron/settings.html`, `server/services/settings-store.ts`, `server/services/transcription-service.ts`.
- Untracked support files: `server/services/people-index.ts` (used by attendee resolution — needed), `_playground/*` (dev tools), `_docs/development-tracker.md`, `_docs/plans/`, `_docs/agent-handoff.md`.
- `out/` is build output — do not commit.
- Local-only: `tsc` is not clean at baseline (3 latent errors); the app ships via esbuild/tsx which skip typechecking, so don't gate on `tsc`.
