# ID-007 — Recording durability plan

> Status: **planned, not started** (saved 2026-06-19). Tracked as ID-007 in `_docs/issue-backlog.md`.
> Decisions still open: see "Open decisions" at the bottom before implementing.

## Root cause

Audio lives only in the renderer's in-memory `audioChunks` array until `mediaRecorder.onstop`,
which calls `start → upload → stop → finalize`. Nothing hits disk until the user clicks Stop.
`POST /recordings/start` is currently called *inside* `onstop` (`electron/capture.html`), so the
recording record doesn't even exist server-side mid-session. Any unclean interruption before a
clean Stop — crash, freeze, OS kill, force-quit, power loss, or a throw in the upload chain
(`capture.html`, the `catch` around the finalize fetches) — loses the **entire** recording.

ID-006's `backgroundThrottling: false` removed one *trigger* (Mission Control). This issue is the
underlying fragility behind every other interruption.

## Core idea

Persist audio **and** notes incrementally *during* recording, then recover orphans on next launch.

## Architecture decision: stream chunks to the local server (not via IPC)

Echo's recording lifecycle is already server-mediated over `http://localhost:3739`
(`start/upload/stop/finalize`), and the server owns the recordings dir + `recordings.json`.
Extend that surface rather than add a binary-chunk IPC channel to main. Keeps file ownership in
one place and reuses the existing `fetch` pattern. At 1 chunk/sec the per-request overhead is
negligible.

## Data-flow change

| Stage | Today | After |
|---|---|---|
| `/start` | called in `onstop` (after recording) | called when recording **begins** → renderer gets `id` |
| each `ondataavailable` | pushed to in-memory array | **also** POSTed to `/recordings/:id/append` → server appends to `<id>.webm` |
| `onstop` | builds blob, uploads, stops, finalizes | drains append queue → `/stop` → `/finalize` (no big upload) |
| crash mid-recording | whole recording lost | partial `<id>.webm` already on disk → recovered on next launch |

**Why streaming append reconstructs a valid file:** MediaRecorder's **first** `dataavailable`
chunk carries the WebM/EBML header; later chunks are continuation clusters. Append them in order
and you get a playable stream. The renderer needs a **sequential queue** (await the previous
append before sending the next) so chunks can't land out of order; the server opens the file in
`'a'` (append) mode.

## Endpoints + store

- **New** `POST /recordings/:id/append` — raw body (`express.raw`), `fs.appendFile` to `<id>.webm`,
  bump `fileSizeBytes`. Status stays `recording`.
- New status `recording` (created → capturing → `uploaded` on stop). `recording-store.ts` gets a
  `listOrphans()` (status `recording`, file size > silence threshold, not finalized). Its header
  comment currently says "no orphan resume" — that is exactly what we are adding; update it.
- Keep `/upload` as a **fallback**: if any append failed mid-session (`flushFailed` flag),
  `onstop` does one full-blob upload to overwrite the partial. Belt and suspenders.

## Notes durability (ties ID-007 to ID-005)

The important synergy: if we flush audio but not the user's notes, a crash still loses the thing
they most wanted kept. Add **`PATCH /recordings/:id/meta`** that the renderer calls (debounced
~500ms) whenever title / attendees / `userNotes` change. Recovery then restores the note text too,
not just audio.

## Recovery on launch

On app ready (server up), check `listOrphans()`. The orphan's WebM may lack final duration/cues, so
run it through **ffmpeg** (`ffmpeg-static`, already a dependency) `-c copy` to remux/repair before
transcription; fall back to direct transcription if remux fails. Recovered notes land in the vault
flagged `[recovered]`.

**Open UX decision (default = auto-recover):**
- **Auto-recover** silently on launch → transcribe, drop in vault flagged `[recovered]`. Zero
  friction, zero loss.
- **Prompt** ("Recover last recording? 12:30, started 2:05pm") before processing.

## Edge cases to handle

- **Truncated WebM** → ffmpeg remux step above.
- **Chunk ordering** → sequential renderer queue + append-mode writes.
- **Crash after stop but before finalize** → orphan scan also catches `uploaded`-but-not-finalized
  and re-runs finalize.
- **Very short partial** → existing silence guard (`SILENCE_FILE_SIZE_THRESHOLD`) already handles.
- **No audio glitches** → append is async, off the audio encoder thread; unchanged from today.
- **Backward compat** → new statuses are additive; existing `recordings.json` entries untouched.

## Files touched

- `electron/capture.html` — `/start` at begin; append queue in `ondataavailable`; debounced
  `/meta`; `onstop` drains then `/stop` + `/finalize`; fallback upload.
- `server/routes/recordings.ts` — `/append` (raw body) + `/meta` (PATCH); `/start` sets `recording`.
- `server/services/recording-store.ts` — `appendAudio()`, `listOrphans()`, new statuses, comment fix.
- `server/services/recording-job-runner.ts` — ffmpeg remux/repair step in a recovery entrypoint.
- `electron/main.ts` (+ maybe server boot) — run orphan recovery on launch.

## Sequencing (each independently testable)

1. Server `/append` + store `appendAudio` (unit-testable: POST bytes, file grows).
2. Renderer streaming + move `/start` to begin + fallback upload.
3. `/meta` + notes recovery.
4. Orphan scan + ffmpeg repair + launch recovery.

**Effort:** large. **Verification:** server endpoints are unit-testable headless; the crash path
needs a manual test — start recording, kill the renderer mid-session (devtools/kill), relaunch,
confirm the partial recording recovers with notes intact. Add a hidden "simulate crash" hook for
that test.

## Open decisions (resolve before building)

1. Recovery UX: **auto-recover** (recommended) vs prompt.
2. Notes `/meta` durability in this pass, or split to a follow-up.
