# Manul

An agentic video editor, named after the Pallas cat. Drop in a video, say what you want, and it does it.

Early days: see [ROADMAP.md](ROADMAP.md) for the plan and how to contribute.

## Develop

```bash
npm install                  # also fetches the pinned ffmpeg/ffprobe and BrowserSkill (bsk CLI + extension) for this machine
./scripts/build-whisper.sh   # builds the bundled whisper-cli (needs cmake: brew install cmake)
npm run dev                  # the app with hot reload
npm run typecheck
npm run smoke      # builds, launches the app, screenshots each screen (set GEMINI_API_KEY and pass a prompt to test the agent)
```

Layout: `src/main` (Electron main: projects, keys, media tools, pi-durable agent and its AG-UI adapter), `src/preload`
(the bridge), `src/renderer` (React + Tailwind; `views/` are the screens, `components/ui/` the shadcn-style primitives),
`src/shared` (types used on both sides).

## The agent's browser

The agent browses the web with [BrowserSkill](https://github.com/Tencent/BrowserSkill) (`bsk`), bundled and private:
Manul runs its own bsk daemon (in its own data folder, on its own port) and the bsk extension inside Manul's built-in
browser (the Browser panel). A bsk you installed in Chrome only knows its own daemon, so it never sees Manul and the
agent never reaches your Chrome, unless you pick **Your Chrome** in Settings → Browser to use your existing logins.
Code: `src/main/bsk.ts` (daemon, which browser), `src/main/browser.ts` + `src/preload/chrome-shim.ts` (the Chrome
extension API rebuilt on Electron), `src/renderer/src/views/BrowserPanel.tsx`.

## Packaging

```bash
npm run package    # dist/: macOS .dmg + .zip, or Linux .deb + AppImage (signing/notarizing happens in CI)
```

## Tests

Development is test-driven: every change comes with tests.

```bash
npm test           # unit + integration (Vitest); Electron is stubbed, ffmpeg is real
MANUL_TEST_TOOLS=<tools folder with whisper installed> npm test   # also runs the downloaded-engine test
npm run test:e2e   # the real app: motion clips render frame-exact, clips have no network
npm run smoke      # the real app, end to end (Playwright)
npm run package:dir && node test/e2e/packaged.e2e.mjs   # the packaged app: tools, clips, skills, export from the bundle
```

Integration tests that need something this machine lacks (whisper.cpp, macOS `say`, an installed tool) skip themselves.
