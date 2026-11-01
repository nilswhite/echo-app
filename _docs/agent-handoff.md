# Agent Handoff

_Last updated: 2026-11-01. Snapshot of repo state for a fresh agent._

## Project State Summary

- Echo is a tray-resident macOS meeting recorder (Electron + local Express server).
- **v1.3.0 is released.** Tagged `v1.3.0` on `main` (commit `3f7e8a9`) and published as the Latest GitHub release with `Echo.dmg` attached: https://github.com/nilswhite/echo-app/releases/tag/v1.3.0
- Version numbers now agree everywhere: `package.json`, `package-lock.json`, `CHANGELOG.md`, and the README Status section all say 1.3.0. Before this release, `package.json` said 1.2.2, the lockfile said 1.1.1, and the newest git tag was `v1.0.2`.
- GitHub releases exist only for v1.0.0, v1.0.1, v1.0.2, and v1.3.0. Versions 1.0.3 through 1.2.2 appear in the CHANGELOG but were never tagged or released; the v1.3.0 release notes summarize them.
- The earlier `feature/user-notes-and-reliability` branch has been merged into `main` and no longer exists. `main` is the only branch, and there are no open PRs.
- What 1.3.0 contains (details in `CHANGELOG.md`):
  - **ID-005 User Notes (closed 2026-06-20).** A Notes button on the recording pill expands it into a taller window with title, attendees, and a notes box. Notes go through finalize POST → `Recording.userNotes` → job runner → structurer (high-priority `User notes:` block) → `obsidian-writer`, which writes them verbatim as `## My Notes` above `## Transcript`.
  - **ID-006 Mission Control fix (closed 2026-06-17).** `backgroundThrottling: false` on the capture window, so the Web Audio `AudioContext` isn't suspended when the window is hidden.
  - **Duration-based transcription chunking.** Recordings longer than 1200s are split into 300s ffmpeg chunks even when the file is under the 25 MB size limit. This fixes timeouts on `gpt-4o-transcribe` and the 1400s input cap on `gpt-4o-transcribe-diarize`.
- The user has been running a July 8 build (reports itself as 1.2.2) day to day, built from the same code as 1.3.0. They consider 1.3.0 ready to use and are installing it from the GitHub release on a second Mac.

## Key Files

- `CHANGELOG.md` — release history; add a new section at the top for each release.
- `package.json` / `package-lock.json` — keep both `version` fields in sync (the lockfile has two: lines 3 and 9).
- `README.md` — the Status section names the current version and should be updated each release.
- `forge.config.ts` — Electron Forge packaging (DMG maker, `LSUIElement`, asar unpack rules).
- `scripts/build-electron.cjs` — esbuild bundle of the main process into `electron-dist/main.cjs`.
- `server/services/transcription-service.ts`, `server/services/recording-job-runner.ts` — transcription and chunking.
- `electron/capture.ts`, `electron/capture.html` — recording pill and notes window.

## Outstanding Work / Next Focus

- **Optional recovery path:** recordings that failed before the chunking fix still have their audio on disk, but there is no way to re-run transcription from the UI. A one-off "reprocess `rec_…`" script or button would recover them.
- **ID-007 (planned, not started):** recording durability. Stream audio and notes to disk during capture and recover orphaned recordings on launch. Plan in `_docs/plans/id-007-durability.md`.
- **Backlog (ordered, each depends on the one before):** ID-001 system audio capture → ID-002 dual-track recording → ID-003 diarization → ID-004 presenting mode. See `_docs/issue-backlog.md`.
- **Not done:** code signing and notarization, auto-update, Intel build. Users must right-click → Open on first launch.

## Release Process (as done for v1.3.0)

1. Add a CHANGELOG section, bump `package.json` and both `package-lock.json` version fields, update README Status.
2. `rm -rf out/make && npm run electron:make` → DMG at `out/make/Echo.dmg` (about 140 MB, arm64). Confirm with `PlistBuddy -c 'Print CFBundleShortVersionString' out/Echo-darwin-arm64/Echo.app/Contents/Info.plist`.
3. Commit as `vX.Y.Z — <summary>`, then annotated tag `git tag -a vX.Y.Z -m "Echo vX.Y.Z — <summary>"`, then `git push origin main vX.Y.Z`.
4. `gh release create vX.Y.Z out/make/Echo.dmg --title "Echo vX.Y.Z — <summary>" --notes-file <notes.md> --latest`. Previous release notes follow this layout: What Echo is, What is new, Install, Known limitations.

## Testing Notes

- `node scripts/build-electron.cjs` builds the main-process bundle; `npm run dev` (`ELECTRON=1 electron .`) runs without a fresh bundle.
- `tsc --noEmit` has 2 pre-existing errors (`electron/main.ts:78`, `server/routes/recordings.ts:40`). The app ships through esbuild/tsx with no typecheck step, so don't block on `tsc`.
- The v1.3.0 DMG was not launched after building, because the installed copy of Echo was running and a second instance wasn't started. The user is confident in it based on daily use of the same code.

## Git Notes

- Repo-local git email is `5048191+nilswhite@users.noreply.github.com` (global config untouched). GitHub blocks pushes that expose the private gmail address, so keep using the noreply address.
- `out/`, `electron-dist/`, `node_modules/`, and `.claude/settings.local.json` are gitignored. Don't commit them.
