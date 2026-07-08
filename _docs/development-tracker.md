# Development Tracker

Running log of progress and on-deck work for Echo. Newest entries on top.
Issues are tracked in `_docs/issue-backlog.md`; this file is the narrative history.

## Open Issues

- **ID-005** (in progress) — User Notes capture (Concept B). Implemented end-to-end; awaiting final visual sign-off on the pill→portrait animation, then commit. Open decision: keep the portrait at the pill width (252px) or widen both pill + portrait to 300px.
- **ID-007** (planned) — Recording durability: stream audio + notes to disk during capture and recover orphans on launch. Plan in `_docs/plans/id-007-durability.md`. Not started.
- **ID-001 → ID-004** (backlog) — System audio capture, dual-track recording, diarization, presenting-mode toggle. Not started.

### Progress Notes

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
