# Manul

An agentic video editor, named after the Pallas cat. Drop in a video, say what you want, and it does it.

Early days: see [ROADMAP.md](ROADMAP.md) for the plan and how to contribute.

## Develop

```bash
npm install
npm run dev        # the app with hot reload
npm run typecheck
npm run smoke      # builds, launches the app, screenshots each screen (set GEMINI_API_KEY and pass a prompt to test the agent)
```

Layout: `src/main` (Electron main: projects, keys, media tools, pi-durable agent and its AG-UI adapter), `src/preload`
(the bridge), `src/renderer` (React + Tailwind; `views/` are the screens, `components/ui/` the shadcn-style primitives),
`src/shared` (types used on both sides).
