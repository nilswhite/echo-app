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


## Closed Issues

