# Echo

Tray-resident macOS Electron app that records meetings (or quick text notes) and pipes structured Markdown into your Obsidian vault inbox.

Press a global hotkey, record, hit stop. Echo transcribes via OpenAI Whisper, structures the transcript via Claude or GPT (your pick), and writes a Markdown file into `<your-vault>/0_Inbox/` with frontmatter, summary, action items, key points, and the full transcript.

## Status

v0.1 in development. See `_docs/plans/echo-mvp-plan.md` for the build plan.

## Dev

```
npm install
npm run dev
```

Compiles nothing — `tsx` loads the TypeScript directly in the Electron main process.

## Packaging

```
npm run electron:make
```

Produces a `.dmg` in `out/`.
