# Development Tracker

Running log of progress and on-deck work for Echo. Newest entries on top.
Issues are tracked in `_docs/issue-backlog.md`; this file is the narrative history.

## Open Issues

- **ID-007** (planned) — Recording durability: stream audio + notes to disk during capture and recover orphans on launch. Plan in `_docs/plans/id-007-durability.md`. Not started.
- **ID-001 → ID-004** (backlog) — System audio capture, dual-track recording, diarization, presenting-mode toggle. Not started. Each one depends on the one before it.
- **Not tracked as an issue yet** — A way to re-run transcription on recordings that failed before the duration-based chunking fix. Their audio is still on disk, but there is no script or button to reprocess a `rec_…` recording.
- **Not done** — Code signing and notarization, auto-update, and an Intel build.

### Progress Notes

#### 2026-11-01 — v1.3.0 released

**Updates**:
- Released **v1.3.0** (commit `3f7e8a9`, tag `v1.3.0`) as the Latest GitHub release with `Echo.dmg` attached. It bundles ID-005 (user notes), ID-006 (Mission Control fix), and the duration-based transcription chunking.
- Brought the version number into agreement everywhere. `package.json`, both `package-lock.json` fields, `CHANGELOG.md`, and the README Status section now all say 1.3.0. Before this, `package.json` said 1.2.2, the lockfile said 1.1.1, and the newest tag was `v1.0.2`.
- Versions 1.0.3 through 1.2.2 are in the CHANGELOG but were never tagged or released. The v1.3.0 release notes summarize them.
- Merged `feature/user-notes-and-reliability` into `main` and deleted the branch. `main` is the only branch.
- Updated `_docs/agent-handoff.md` with the release process used for this version.

**Testing**
- [x] DMG built with `npm run electron:make`; `CFBundleShortVersionString` confirmed as 1.3.0
- [x] Same code has been in daily use since the July 8 build (which reports itself as 1.2.2)
- [ ] The v1.3.0 DMG itself was not launched after building, because the installed copy of Echo was running. The user is installing it from the GitHub release on a second Mac.

#### 2026-07-08 — ID-005 committed and closed, long-recording transcription fix

**Updates**:
- Committed ID-005 (user notes) and the ID-006 fix together (`9aade24`). Moved ID-005 to Closed Issues in the backlog after Chris verified it end to end on 2026-06-20: notes typed mid-recording appeared verbatim under `## My Notes`, and the AI summary and action items reflected them.
- Settled the open width question from 2026-06-20: the notes window keeps the pill's 252px width and only grows in height, to 432px (`PILL_WIDTH` and `NOTES_PORTRAIT_H` in `electron/capture.ts`).
- Fixed transcription failures on long meetings (`5603c78`). Recordings longer than 1200s are now split into 300s ffmpeg chunks even when the file is under the 25 MB size limit. Before this, long but small files were sent whole, which timed out on `gpt-4o-transcribe` and went over the 1400s input limit on `gpt-4o-transcribe-diarize`.

**Testing**
- [x] ID-005 end-to-end check passed (record, add attendee and notes mid-recording, Stop, check the `.md`)
- [x] Long recordings transcribe after the chunking fix

#### 2026-06-20 09:30 — User Notes (ID-005): pill → portrait animation, jiggle fixes

**Updates**:
- Implemented ID-005 **Concept B**: a single **Notes** button on the recording pill (with attendee-count badge) that expands the pill in place into a portrait window — title + attendees + free-form "Your notes" inline, pill controls (mic selector, volume bars, timer, stop, expand) pinned at the top.
- Retired the separate attendees popover entirely: deleted `electron/capture-attendees.html`, removed `captureAttendeesWindow` + its IPC (`attendees-show/hide/set`, `user-notes-set`) and the theme-broadcast hook in `settings.ts`. Attendee parsing + People-folder resolution moved inline into `capture.html`. Preload collapsed to a single `toggleNotes`.
- Server pipeline (unchanged through the UI rework): `userNotes` rides the finalize POST → `recordings.ts` → `recording-store.ts` → `recording-job-runner.ts`. `markdown-structurer.ts` injects a `User notes:` block before the transcript + a HIGH-PRIORITY system rule; `obsidian-writer.ts` writes a verbatim `## My Notes` section before `## Transcript`, threaded into every job path (success, structuring-failed, silent, hallucination, error).
- Animation iterated against four dogfood recordings (frame-stepped via ffmpeg):
  - v1 native animated resize → content dragged up over the pill (Cocoa bottom-anchors content mid-resize).
  - v2 clip-path reveal → snapped open (IPC-ack fired before viewport grew; rAF coalesced the transition).
  - v3 resize-event-triggered clip + reflow → open clean, but close showed a shadow **ghost** (full-size frame) + width **bump** at the end.
  - v4 (current) — **main steps the window bounds itself** (`setBounds` per frame, `animate:false`), constant width, height-only, easeInOutCubic. Content stays top-anchored; the window edge is the mask so the shadow tracks the real frame (no ghost), it ends exactly on target (no bump), and there's no horizontal reflow (no jiggle).
- Built a 3-option comparison playground (`_playground/user-notes-playground.html`) to choose the layout (Concept B picked).
- Resolved **ID-006** (see below); filed **ID-007** durability plan.
- All changes are working-tree only (not committed). Verified per build: `node scripts/build-electron.cjs` exit 0, inline HTML scripts parse, `tsc` adds no new errors over baseline, DMG packaged (`out/make/Echo.dmg`).

**Testing**
- [x] Electron bundle builds clean (esbuild) after each iteration
- [x] No new TypeScript errors over baseline
- [x] Inline capture HTML scripts parse
- [x] Open transition (pill → portrait) verified via frame-stepping — clean
- [ ] Close transition (portrait → pill) — confirm no ghost/bump/jiggle in v4 build
- [ ] End-to-end: record → add attendee + notes mid-recording → Stop → `.md` has `## My Notes` verbatim and AI summary/actions reflect notes
- [ ] Window edge-clamping when pill is near a display edge
- [ ] Decide portrait width: 252px (matches pill) vs 300px (wider, pill also widens)

#### 2026-06-17 — Recording reliability (ID-006 fix, ID-007 filed)

**Updates**:
- **ID-006 (Closed):** Mission Control (three-finger swipe-up) was killing the active recording. Root-caused to Chromium throttling the occluded capture renderer — Echo records from a Web Audio graph (`MediaRecorder(destinationNode.stream)`) whose `AudioContext` gets suspended when the window is occluded. Fix: `backgroundThrottling: false` on the capture `BrowserWindow` (`electron/capture.ts`), set at construction to avoid the dynamic-toggle visibility desync. App-logic teardown ruled out by elimination.
- **ID-007 (filed):** Surfaced the deeper durability hole — audio lives only in the renderer's in-memory `audioChunks` until `onstop`, so any unclean interruption loses the whole recording. Implementation plan saved to `_docs/plans/id-007-durability.md`.

**Testing**
- [x] Build verified; `backgroundThrottling: false` present in packaged bundle
- [ ] Manual: record → Mission Control swipe → return → Stop → recording persists with no gap
