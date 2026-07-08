# Issue Backlog

## Open Issues


<details>
<summary><strong>ID-001</strong> | Feature | 🔥 | System audio capture via ScreenCaptureKit native addon (v0.2 — post-MVP)</summary>

- **TL;DR:** Echo's MVP records mic only. To make Echo actually useful for meetings, it has to capture *system* audio — what the remote participants are saying through Teams / Zoom / Meet — not just the local mic. macOS doesn't expose a loopback device, so this requires a native Node addon backed by ScreenCaptureKit (macOS 13+). Cribbed from Strata's ID-143 spec and `_docs/plans/meeting-recorder-plan.md` §4a, scoped down to the audio-only path Echo actually needs.
- **Current:** `electron/capture.html` uses `navigator.mediaDevices.getUserMedia({ audio: true })` for mic capture only. The remote participant's audio never enters the recording pipeline; transcripts contain only the local speaker's voice. There is no system-audio path, no permission flow, no native addon.
- **Expected:**
  - **(1)** Add a Node native addon (or vetted npm package — `node-macos-system-audio-recorder` is the candidate per the Strata plan) that uses ScreenCaptureKit to capture system audio output as raw PCM. System-wide capture is fine for v0.2; per-app targeting via `SCContentFilter` is a follow-up.
  - **(2)** First-launch flow that triggers macOS's "Screen & System Audio Recording" permission prompt. Show a tray-anchored explainer if permission is denied, with a "Reopen System Settings" button. macOS Sequoia re-prompts monthly — surface this in the capture pill the first time a re-prompt happens after a period of denial.
  - **(3)** Setting toggle in `electron/settings.html`: "Capture system audio" (default on once permission is granted). When off, Echo records mic-only just like MVP.
  - **(4)** ffmpeg encode the PCM stream to MP3/M4A (~64 kbps) for storage, matching the existing on-disk format used by the mic path so the rest of the pipeline (transcription, Obsidian writer) stays unchanged.
  - **(5)** Forge config — bundle the prebuilt arm64 binary as an unpacked native asset (mirrors the existing `ffmpeg-static` unpack rule).
- **Likely files:**
  - **New:** `electron/native/system-audio.ts` (TS wrapper around the addon) and either `electron/native/system-audio.node` (prebuilt binary) or a vendored `node_modules` package
  - `electron/capture.ts` — wire system-audio start/stop alongside the existing mic stream; pipe both into the upload payload
  - `electron/capture.html` — surface a system-audio status indicator in the pill (e.g., a small monitor-glyph next to the mic-glyph) and toggle visibility from settings
  - `forge.config.ts` — extend the unpack-natives rule to cover the new binary
- **Risk/notes:**
  - **(1)** Prerequisite for ID-002 (dual-track) and ID-003 (diarization) — neither makes sense until system audio is actually being captured. Land this first.
  - **(2)** ScreenCaptureKit addon build is fragile across macOS SDK versions. Pin the SDK in CI; ship a prebuilt arm64 binary to avoid asking end users to compile. Document an Intel build path only if needed.
  - **(3)** The macOS-enforced purple menu-bar dot during capture is a feature, not a bug — don't try to suppress it.
  - **(4)** Privacy boundary: audio leaves the device only for transcription (OpenAI Whisper). No analytics, no telemetry on audio content. Document this in README before shipping v0.2.
  - **(5)** Mic-only fallback must remain the safe default if the addon fails to load (e.g., macOS <13, build issue, denied permission). Echo should degrade gracefully, not refuse to record.
- **Labels:** type: feature, priority: high, effort: x-large

</details>


<details>
<summary><strong>ID-002</strong> | Feature | 🔥 | Dual-track recording — mic + system audio captured as separate streams, mixed for transcription</summary>

- **TL;DR:** Once ID-001 is in, Echo can capture system audio. The next step is recording mic + system audio as *two* tracks (not one), then mixing them into a single file before transcription. Two-track capture preserves the source separation that diarization needs (ID-003) and avoids feedback artifacts when the user is screen-sharing their own audio. Cribbed from Strata's `meeting-recorder-plan.md` §4a, "Dual-track recording".
- **Current:** N/A in Echo (no system audio yet — see ID-001). When ID-001 lands without dual-track, mic + system audio would mix into a single PCM stream at capture time, losing the per-source signal that helps diarization and feedback de-duplication.
- **Expected:**
  - **(1)** Capture two parallel streams: mic via Web Audio in the renderer (existing path), system audio via the ScreenCaptureKit addon (ID-001). Both write to disk as separate files (`<id>-mic.<ext>`, `<id>-sys.<ext>`).
  - **(2)** Post-stop, ffmpeg mixes the two tracks into a single mono/stereo file used for transcription. Originals are kept until transcription succeeds, then discarded (configurable via the existing `retainAudio` toggle).
  - **(3)** Feedback de-dup — when the user is presenting and their own mic audio bleeds back through system capture, the transcript can double-count their words. Phase-1 mitigation: log the issue + recommend Presenting Mode (ID-004). Phase-2 mitigation (deferred): a near-duplicate detection pass at the audio level.
  - **(4)** Pill UI surfaces both meters (a tiny mic icon + a tiny speaker icon, each with their own level indicator) so the user can tell at a glance that both sides are live.
- **Likely files:**
  - `electron/capture.ts` — split recording start/stop into a two-stream coordinator
  - `electron/capture.html` — second level meter, second silence warning
  - `server/services/recording-store.ts` — persist mic + system file paths separately on the recording record
  - `server/services/recording-job-runner.ts` — call ffmpeg to mix before passing to `transcription-service.ts`; clean up source files on success
- **Risk/notes:**
  - **(1)** Depends on **ID-001**. Pointless until system audio capture exists.
  - **(2)** Stream sync — mic and system audio start at slightly different times. Either record start timestamps and ffmpeg-align, or accept ~50 ms drift (acceptable for transcript quality).
  - **(3)** Disk usage doubles during recording (two source files + one mixed). Clean up source files immediately after a successful mix unless `retainAudio` is on.
- **Labels:** type: feature, priority: high, effort: large

</details>


<details>
<summary><strong>ID-003</strong> | Feature | ⚡ | Speaker diarization in transcripts — label "you" vs other participants in the structured Markdown</summary>

- **TL;DR:** Once dual-track is live (ID-002), Echo can ship a real diarized transcript: "Speaker A said X, Speaker B said Y." For solo-recorded meetings (mic captures the user, system captures everyone else) the simplest cut is binary — label mic-track as "You" and system-track speakers as "Speaker A / B / C", then let the user rename them post-hoc. Cribbed from Strata's ID-143 §3 ("Transcription with speaker diarization").
- **Current:** Echo MVP produces a flat transcript with no speaker labels. The Claude structuring pass (markdown-structurer.ts) generates a summary + action items but can't attribute who said what.
- **Expected:**
  - **(1)** Use mic-track vs system-track provenance from ID-002 to label utterances at minimum as "You" vs "Other" — a free win that doesn't require any model upgrade.
  - **(2)** For finer-grained labels among system-audio speakers, switch the transcription provider to one with built-in diarization. Strata's plan recommends FluidAudio (local, free) as default and OpenAI `gpt-4o-transcribe-diarize` or AssemblyAI Universal-2 as cloud alternatives.
  - **(3)** Frontmatter gets a `speakers: [...]` array. The Markdown body interleaves speaker labels: `**You:** ... / **Speaker A:** ...` per utterance, and the structured "Action Items" section uses the labels for assignee inference.
  - **(4)** Post-hoc rename — when the user opens the `.md` in Obsidian and edits "Speaker A" → "Mark Johnson", that's just a text edit. No app-side rename UI needed in v0.2; revisit if it becomes annoying.
- **Likely files:**
  - `server/services/transcription-service.ts` — add a `diarize: true` path (currently always false) and a provider selector in settings
  - `server/services/markdown-structurer.ts` — feed diarized segments into the Claude prompt; emit speaker-attributed action items
  - `server/services/obsidian-writer.ts` — render diarized segments in the `## Transcript` section
  - `electron/settings.html` + `settings-store.ts` — provider picker, default = OpenAI w/ diarize on (FluidAudio local is a future option, more complexity)
- **Risk/notes:**
  - **(1)** Depends on **ID-002**. The "You vs Other" win specifically requires dual-track provenance.
  - **(2)** OpenAI's diarized model has the same 25 MB / ~50 min limit; existing chunking logic in `transcription-service.ts` already handles this — speaker labels need stitching across chunks (Speaker A in chunk 1 ≠ Speaker A in chunk 2 by default). Punt on perfect cross-chunk identity; accept that long meetings may need post-hoc cleanup.
  - **(3)** Cost goes up — `gpt-4o-transcribe-diarize` is ~$0.36/hr vs Whisper's $0.006/min ($0.36/hr — actually similar). Confirm pricing before shipping.
  - **(4)** This issue specifically scopes to *transcript-level* diarization. Voice-print-based "who is speaking" identification (matching to a People directory) is explicitly out of scope — Echo has no People directory.
- **Labels:** type: feature, priority: normal, effort: large

</details>


<details>
<summary><strong>ID-004</strong> | Feature | ⚡ | Presenting mode toggle — quick mic-only switch in the pill for when the user is sharing audio</summary>

- **TL;DR:** When the user is screen-sharing with their own audio (e.g., playing a video, demo'ing software with sound), system audio capture causes the user's *own* voice to be recorded twice — once via mic, once via system loopback — producing duplicated transcript content. A simple in-pill toggle that disables system audio for the rest of the recording solves it without forcing the user to reach into Settings. Cribbed from Strata's `meeting-recorder-plan.md` §"Phase D — Presenting mode toggle".
- **Current:** N/A in Echo today (no system audio). Once ID-001 + ID-002 land, this becomes the obvious next ergonomic gap.
- **Expected:**
  - **(1)** A small toggle button in the recording pill: a "headphones" icon when system audio is on, crossed-out when off. One click flips it mid-recording.
  - **(2)** Flipping mid-recording stops the system-audio stream cleanly and lets the mic stream continue. Resuming flips system back on. The mixed file at the end seamlessly skips the system track during the off interval.
  - **(3)** Persisted as a *per-recording* state, not a global setting — the next recording defaults back to system-audio-on (most meetings want it on).
- **Likely files:**
  - `electron/capture.html` — pill UI: presenting-mode toggle button + visual state
  - `electron/capture.ts` — IPC for stop/start of the system-audio stream mid-recording
  - `server/services/recording-job-runner.ts` — handle a recording where the system-audio file has gaps, when mixing
- **Risk/notes:**
  - **(1)** Depends on **ID-001** + **ID-002**.
  - **(2)** ffmpeg mixing of a mic stream with a *gappy* system stream — easiest is to treat the system stream as silence during off intervals (pad with silence to match length).
  - **(3)** Don't make this a setting screen item — the entire value is that it's one click during the meeting. Tray + Settings don't help when you're mid-screen-share.
- **Labels:** type: feature, priority: normal, effort: medium

</details>


<details>
<summary><strong>ID-007</strong> | Bug | 🔥 | Recording durability — entire capture is lost if the renderer is interrupted before a clean Stop</summary>

- **TL;DR:** A recording is only persisted in `mediaRecorder.onstop`, built from an in-memory `audioChunks` array (`capture.html:557–581`). Nothing touches disk until the user clicks Stop. So any unexpected interruption of the capture renderer before that — crash, freeze, OS kill, force-quit, power loss, an unhandled error in the upload chain — loses the **entire** recording, not just a tail. For long meetings this is the worst-case failure: an hour of audio gone with no artifact. Surfaced while investigating ID-006 (Mission Control); that fix removes one trigger, but the underlying fragility remains for every other interruption.
- **Current:**
  - `mediaRecorder.start(1000)` emits a chunk every second into `audioChunks` (in memory only).
  - `onstop` is the *sole* persistence path: it Blobs the chunks, then `start` → `upload` → `stop` → `finalize` against the server. If the renderer dies before `onstop`, the array is gone. If `onstop` runs but any fetch in the chain throws, the `catch` just recolors the input — the audio is not saved anywhere recoverable (`capture.html:615`).
  - No crash recovery, no resumable/partial file, no on-disk journal of in-flight audio.
- **Expected:**
  - Audio survives an unclean interruption. Target: an interrupted session yields a recoverable partial recording instead of nothing.
  - **(Approach A — incremental disk flush)** Stream chunks to a temp file on disk as they arrive (via IPC to main, or a server "append" endpoint) instead of holding them in renderer memory. On next launch, detect an orphaned in-progress file and offer to finalize/transcribe it.
  - **(Approach B — crash-safe finalize)** At minimum, if the `onstop` upload chain fails, persist the Blob locally (download to disk / hand to main via IPC) so the user can retry rather than losing it silently.
  - Recovery UX: on startup, if an unfinalized recording exists, surface "Recover last recording?" rather than discarding it.
- **Likely files:**
  - `electron/capture.html` — chunk handling (`ondataavailable`, `onstop`), failure path at `capture.html:615`
  - `electron/capture.ts` / `electron/main.ts` — IPC to stream/flush chunks to disk; orphan detection on launch
  - `server/routes/recordings.ts` / `server/services/recording-store.ts` — an append/resumable upload path and orphan finalize
- **Risk/notes:**
  - Bigger lift than ID-006 — this is the structural fix behind the same class of bug. ID-006 stopped the bleeding for the common case (Mission Control); this addresses the general case.
  - Disk I/O during recording must not introduce audio glitches — flush off the audio thread.
  - Keep the happy path unchanged; recovery is additive.
- **Labels:** type: bug, priority: high, effort: large

</details>


## Closed Issues


<details>
<summary><strong>ID-006</strong> | Bug | 🔥 | Mission Control (three-finger swipe up) kills the active recording — RESOLVED (fix applied; manual verification recommended)</summary>

- **Status:** Closed 2026-06-17. Fix applied; one manual end-to-end check recommended (see below).
- **Symptom:** Three-finger swipe to Mission Control during an active recording stopped capture and the recording didn't persist.
- **Root cause (confirmed by elimination + documented platform behavior):** All application-logic causes ruled out — the renderer never stops/cancels the recorder on Mission Control (Escape mid-recording collapses to the pill, `capture.html:731`; `cancelCapture` is never called while recording; `hideCaptureSilently()` only hides the window, which does not stop a `MediaRecorder`), and the window is reused, not reloaded, on show. Real mechanism: Echo records from a **Web Audio graph** (`new MediaRecorder(destinationNode.stream)`, `capture.html:556`); Chromium suspends the `AudioContext` and throttles timers when the window is occluded (Mission Control / Space switch / another app) because the capture `BrowserWindow` was created without `backgroundThrottling: false`. Same path as Electron [#12048](https://github.com/electron/electron/issues/12048). The throttled `setInterval` timer also froze, which is why it *looked* stopped.
- **Fix:** added `backgroundThrottling: false` to the capture window's `webPreferences` (`electron/capture.ts:82`), set at construction time to avoid the dynamic-toggle visibility desync ([#50250](https://github.com/electron/electron/issues/50250)). Build verified (`node scripts/build-electron.cjs`, exit 0; flag present in `electron-dist/main.cjs`).
- **Manual verification (recommended before trusting in prod):** `npm run dev` → start a recording → three-finger swipe to Mission Control, switch to another window ~30s, return → Stop → confirm the `.md` + audio persist and the transcript covers the swipe interval with no silent gap.
- **Related:** structural durability follow-up tracked as **ID-007** (in-memory-only persistence loses the whole recording on any unclean interruption).
- **Labels:** type: bug, priority: high, effort: medium
</details>


<details>
<summary><strong>ID-005</strong> | Feature | ⚡ | User notes — manual context/actions field in the expanded capture window, fed to the summary pipeline with priority — RESOLVED (verified)</summary>

- **Status:** Closed 2026-06-20. Implemented (Concept B) and manually verified by Chris. Moved from Open to Closed.
- **TL;DR:** Let the user type their own context, notes, and action items — primarily **live, during the recording** (live note-taking is the headline use case), and also before it starts — and have those flow into the synthesis pipeline as high-priority signal. Repurpose the existing "+ Add attendees" popover into an "+ Add notes" affordance that expands the capture window into a portrait-sized panel: the attendee field stays at the top, and a free-text "User notes" area sits below it. The structuring pass must treat these notes as authoritative — anything the user explicitly flagged gets surfaced in the final summary. The raw notes are also written verbatim into the output `.md` (preceding the transcript) for traceability, but the synthesis/summary is the primary deliverable.
- **Current:** The pill exposes a "+ Add attendees" button (`capture.html:343`) that opens a small dropdown popover (`capture-attendees.html`, a ~80px textarea + resolved-list). Attendees are sent to the server on stop (`body: JSON.stringify({ userTitle, attendees })`, `capture.html:601`) and threaded into the Claude prompt via `markdown-structurer.ts` (`attendeesBlock`, `buildSystemPrompt`). There is no field for free-form user notes; the summary is generated purely from the transcript + attendee list.
- **Expected:**
  - **(1)** Rebrand the pill button from "+ Add attendees" → "+ Add notes" (keeps attendee entry, adds notes). Clicking expands the window into a portrait notes panel rather than the current short dropdown.
  - **(2)** Panel layout: attendee field/resolved-list at the top (existing behavior), a labeled "User notes" open text field at the bottom — multiline, generous height, for manual context / decisions / action items the user wants guaranteed in the summary.
  - **(3)** **Live note-taking (primary use case):** the notes panel must be usable before recording starts *and* while recording is in progress. Notes are edited continuously and held as source-of-truth in the renderer (mirror the existing attendees IPC pattern: `attendees-picker:changed`), so the latest text is captured at stop regardless of when it was typed.
  - **(4)** Persist notes alongside attendees: include `userNotes` in the stop payload (`capture.html` POST body), carry it through `recordings.ts` → `recording-store.ts` → `recording-job-runner.ts` → `markdown-structurer.ts`.
  - **(5)** Synthesis priority: add a `User notes:` block to the structurer user message and a system-prompt instruction that these are user-authored and must be reflected in the summary, key points, and action items with priority over transcript-only inferences (without inventing beyond what's stated).
  - **(6)** Verbatim in output: write the raw notes into the `.md` as their own section (e.g. `## My Notes`), positioned **before** `## Transcript` (after the synthesis sections). This is for traceability only — the summary remains the primary deliverable. Skip the section entirely when notes are empty.
- **Likely files:**
  - `electron/capture-attendees.html` — expand into the portrait notes panel; add the "User notes" textarea below the attendee field
  - `electron/capture.ts` / `capture.html` — window-size/expansion logic, button relabel, live `userNotes` IPC + inclusion in stop payload
  - `server/services/markdown-structurer.ts` — new `userNotes` param, `User notes:` block, system-prompt priority rule
  - `server/services/obsidian-writer.ts` — render the verbatim `## My Notes` section before `## Transcript` (`buildMarkdown`, around line 191)
  - (thread-through) `server/routes/recordings.ts`, `server/services/recording-store.ts`, `recording-job-runner.ts`
- **Risk/notes:**
  - Window resize: the capture window currently uses fixed pill heights (`PILL_HEIGHT_WITH_TITLE`, `capture.ts:22`). The portrait panel needs its own sizing path; ensure it collapses back cleanly and doesn't fight the attendees-show/hide IPC. It must also coexist with the live recording pill state (panel open *while* recording).
  - Keep `userNotes` optional end-to-end so existing recordings without notes structure unchanged.
  - "Priority" wording in the prompt must avoid encouraging fabrication — notes are authoritative for *what to include*, not license to invent details.
  - Live editing during recording: ensure typing in the notes field never steals focus/clicks from the recording controls or interrupts capture.
- **Labels:** type: feature, priority: normal, effort: medium
- **Design chosen (2026-06-19):** Concept B — the pill **expands in place into a portrait window** (pill controls pinned as the header, attendees + notes fields inline below). Picked via the 3-option playground (`_docs/user-notes-playground.html`). The earlier popover approach (Concept A) was replaced. Backend behavior is unchanged from the first implementation.
- **Revised (2026-06-19, after dogfooding):** first cut layered a chevron → title-row → add-notes ladder (3+ transitions, plus a broken empty "half-pill" intermediate). Replaced with the true Concept B: a single **Notes** button on the pill bar (shows an attendee-count badge) that toggles the whole portrait in one click each way. Removed the chevron strip + `with-title` mode + the `capture:pill-title-toggle` IPC entirely; the title field moved into the portrait (top). Pill widened to `252×44` to seat the Notes button alongside the **mic selector + volume bars** (kept, per feedback). Build clean, no dangling refs.
- **Implemented (2026-06-19, Concept B — pending manual UI verification):**
  - **UI (inline, one window):** the `+ Add notes` button (→ `Notes [n]`) now toggles `notes-mode` on the capture window itself — no second window. Main resizes the pill to a portrait `300×432` (`capture:notes-toggle` in `electron/capture.ts`, anchored top-right so it grows down/left) and `capture.html` reveals an inline `.pill-notes-panel`: pill bar on top, then the attendees field + linked-people list, then a tall "Your notes" field. Esc / Stop / collapsing the title closes it.
  - **Retired the popover:** deleted `electron/capture-attendees.html` and removed `captureAttendeesWindow` + all its IPC (`attendees-show/hide/set`, `user-notes-set`, the cross-window mirror) and the `getCaptureAttendeesWindow` theme-broadcast hook in `settings.ts`. Attendee parsing + People-folder resolution moved inline into `capture.html` (still uses the `attendees:resolve` invoke).
  - **Live capture:** fields write straight to the canonical `attendees`/`userNotes` in the capture renderer (no IPC round-trip), so the latest text is captured at Stop whether the panel is open or closed, before or during recording. Same window as the recorder ⇒ inherits the `backgroundThrottling:false` fix.
  - **Persistence:** `userNotes` rides the finalize POST → `recordings.ts` → `recording-store.ts` (`Recording.userNotes`) → `recording-job-runner.ts`. (unchanged)
  - **Synthesis priority:** `markdown-structurer.ts` adds a `User notes:` block before the transcript + a "HIGH PRIORITY" system-prompt rule. (unchanged)
  - **Verbatim output:** `obsidian-writer.ts` renders `## My Notes` before `## Audio`/`## Transcript`, threaded into all job-runner paths. (unchanged)
  - **Build/checks:** `node scripts/build-electron.cjs` exit 0; `capture:notes-toggle` present and all old popover refs gone from `electron-dist/main.cjs`; `capture.html` inline script parses; `tsc` adds zero new errors over baseline; no dangling references to the removed window/IPC.
- **Verified (manual, 2026-06-20):** `npm run dev` → record → `+ Add notes` → pill grows into the portrait window with controls on top → added an attendee + typed a distinctive action item mid-recording → clicked away and back (recording kept running) → Stop → vault `.md` has `## My Notes` verbatim **and** the AI `## Summary`/`## Action Items` reflect the noted action. Window animates back to the pill cleanly. Confirmed working by Chris.

</details>

