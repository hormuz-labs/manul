# Third-party software shipped with Manul

## FFmpeg 9.0.2 (ffmpeg, ffprobe)

Manul runs FFmpeg as separate programs; it does not link against it.

- **Licence:** GNU General Public License v3 (this build is configured with `--enable-gpl --enable-version3` and
  includes libx264, libx265, libass and others).
- **Builds:** static binaries from https://ffmpeg.martin-riedl.de (pinned by SHA-256 in `scripts/fetch-ffmpeg.mjs`).
- **Source:** https://ffmpeg.org/download.html (release 9.0.2). Each library's source and the build scripts are
  listed at https://ffmpeg.martin-riedl.de. On request we will also provide the exact sources for the binaries we ship.

## whisper.cpp v1.9.4 (whisper-cli)

MIT licence, https://github.com/ggml-org/whisper.cpp. Built statically by `scripts/build-whisper.sh` (Metal embedded on
macOS). The model (ggml-base, MIT, from huggingface.co/ggerganov/whisper.cpp) is downloaded on first use, SHA-256 checked.

## BrowserSkill 0.3.2 (bsk CLI, its Chrome extension, its agent skill)

MIT licence, Copyright (c) 2026 Tencent, https://github.com/Tencent/BrowserSkill. Release binaries and the extension
package are pinned by SHA-256 in `scripts/fetch-bsk.mjs`; the agent skill (`skills/browser-skill`) is copied from the
same release with only its description changed. Manul runs the extension unmodified inside its own browser.

## Tools downloaded on demand

Downloaded only after the user agrees, into Manul's own folder: uv (Apache-2.0/MIT), faster-whisper (MIT),
Whisper models (MIT).
