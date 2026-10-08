# Third-party software shipped with Manul

## FFmpeg 9.0.2 (ffmpeg, ffprobe)

Manul runs FFmpeg as separate programs; it does not link against it.

- **Licence:** GNU General Public License v3 (this build is configured with `--enable-gpl --enable-version3` and
  includes libx264, libx265, libass and others).
- **Builds:** static binaries from https://ffmpeg.martin-riedl.de (pinned by SHA-256 in `scripts/fetch-ffmpeg.mjs`).
  Windows x64 uses Gyan Doshi's **9.0.2 essentials static GPLv3 build**, not the shared/full build:
  https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2.
  ZIP SHA-256: `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`.
  Only `ffmpeg.exe` and `ffprobe.exe` are copied from its nested `bin/`; upstream `LICENSE` and `README.txt`
  ship as `bin/ffmpeg-LICENSE.txt` and `bin/ffmpeg-README.txt` (configuration and external-library versions).
- **Source:** https://ffmpeg.org/download.html (release 9.0.2). Each library's source and the build scripts are
  listed at https://ffmpeg.martin-riedl.de. On request we will also provide the exact sources for the binaries we ship.
  The Windows release identifies FFmpeg source commit https://github.com/FFmpeg/FFmpeg/commit/946fcce07b;
  build information: https://www.gyan.dev/ffmpeg/builds/. Preserve the exact corresponding sources, library
  sources and build configuration before publishing; a generic FFmpeg source link alone is not sufficient.

## whisper.cpp v1.9.4 (whisper-cli)

MIT licence, https://github.com/ggml-org/whisper.cpp. Built by `scripts/build-whisper.mjs`, preserving
`scripts/build-whisper.sh` on Unix (Metal embedded on macOS). Windows x64 uses MSVC static CRT, CPU-only SSE2
baseline and no OpenMP; upstream licence ships as `bin/whisper-LICENSE.txt`.
The Windows CMake wrapper embeds a Manul-owned `activeCodePage=UTF-8` manifest for Windows 10
1903/build 18362 or newer. Upstream v1.9.4 sources are not patched; narrow CLI/input/output paths use the
same UTF-8 encoding as upstream's model loader. Manifest: `scripts/windows-whisper/whisper-cli.manifest`.
The model (ggml-base, MIT, from huggingface.co/ggerganov/whisper.cpp) is downloaded on first use, SHA-256 checked.

## BrowserSkill 0.3.2 (bsk CLI, its Chrome extension, its agent skill)

MIT licence, Copyright (c) 2026 Tencent, https://github.com/Tencent/BrowserSkill. Release binaries and the extension
package are pinned by SHA-256 in `scripts/fetch-bsk.mjs`; the agent skill (`skills/browser-skill`) is copied from the
same release with only its description changed. Manul runs the extension unmodified inside its own browser.
Windows CLI: `bsk-v0.3.2-x86_64-pc-windows-msvc.zip` from the `cli-v0.3.2` release, containing `bsk.exe`.
ZIP SHA-256: `b773c443275b8581af29b314baa799e1ec599464379998edcf1dbc7eb07a7eab`.

## Microsoft Visual C++ runtime (Windows only)

`bin/vcruntime140.dll` is the x64 Visual Studio 2022 redistributable required by the pinned BrowserSkill
MSVC binary. Copyright Microsoft Corporation; distributed under the Visual Studio licence's
redistributable-code terms, not the GPL or MIT licence. Copied from the build toolchain's
`VC/Redist/MSVC/<version>/x64/Microsoft.VC143.CRT`, with its Microsoft signature checked in CI.
Version follows the selected VS2022 toolchain; it is not an upstream ZIP pin.
Redistribution list: https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution.
Licence: https://visualstudio.microsoft.com/license-terms/.
Review the applicable toolchain terms before a public Windows release.

## Inter 4.1 (font)

SIL Open Font License 1.1, https://github.com/rsms/inter. Used for clip typography (woff2, via @fontsource-variable/inter)
and for burned-in captions (`Inter-Regular.ttf`, `Inter-Bold.ttf` from the v4.1 release; licence in `lib/fonts/Inter-LICENSE.txt`).

## Tools downloaded on demand

Downloaded only after the user agrees, into Manul's own folder: uv (Apache-2.0/MIT), faster-whisper (MIT),
Whisper models (MIT).
