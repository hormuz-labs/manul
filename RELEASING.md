# Releasing Manul

Push a tag and CI does the rest:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/release.yml` then:
1. builds on four runners (macOS arm64 + Intel, Linux x64 + arm64): bundled whisper.cpp, pinned ffmpeg, tests;
2. packages, **signs and notarizes** the Mac app (when the Apple secrets exist), and publishes `.dmg`, `.zip`,
   `.deb`, AppImage and the `latest*.yml` update files to **GitHub Releases** — this is what installed apps update from;
3. updates the **Homebrew cask** in the tap (when `HOMEBREW_TAP` is set);
4. rebuilds and signs the **apt repository** and uploads it (when `APT_BUCKET` is set).

When `resources/skills/**` changes on main, `.github/workflows/skills.yml` signs the **skills feed**
(`updates/skills.json`), which installed apps pick up within 6 hours — no app release needed.

## One-time setup (owner)

| What | Where | Why |
|---|---|---|
| The `hormuz-labs/manul` repository | GitHub | code, releases (the update feed), the skills feed |
| Apple Developer Program ($99/yr) | developer.apple.com | signing + notarization; Homebrew drops casks Gatekeeper blocks |
| `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD` | repo secrets | "Developer ID Application" certificate (.p12, base64) |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | repo secrets | notarization |
| `MANUL_SKILLS_KEY` | repo secret | contents of `~/.config/manul/skills-signing.pem` (Ed25519 private key; its public half ships in `resources/skills-public.pem`). Keep a backup: a lost key means shipping a new public key in an app release |
| `hormuz-labs/homebrew-tap` repository | GitHub | `brew install hormuz-labs/tap/manul` |
| `HOMEBREW_TAP` = `hormuz-labs/homebrew-tap` (variable), `TAP_TOKEN` (secret) | repo settings | token with write access to the tap |
| A file host for the apt repository (e.g. Cloudflare R2) | — | `.deb` files are ~150–200 MB; GitHub Pages and git refuse files over 100 MB |
| `APT_BUCKET`, `APT_ENDPOINT`, `APT_GPG_KEY_ID` (variables); `APT_ACCESS_KEY_ID`, `APT_SECRET_ACCESS_KEY`, `APT_GPG_PRIVATE_KEY` (secrets) | repo settings | upload + signing of the apt repository |
| A domain for the apt repository (placeholder `apt.manul.app` in `scripts/apt-repo.sh`) | DNS | the line users add to their sources |

Without the Apple secrets, releases still build but the Mac app is unsigned (users must right-click → Open).

## Installing

```bash
brew install hormuz-labs/tap/manul
```

```bash
curl -fsSL https://apt.manul.app/manul.gpg | sudo gpg --dearmor -o /usr/share/keyrings/manul.gpg
echo "deb [signed-by=/usr/share/keyrings/manul.gpg] https://apt.manul.app stable main" | sudo tee /etc/apt/sources.list.d/manul.list
sudo apt update && sudo apt install manul
```

## Checks before tagging

```bash
npm run typecheck && npm test
npm run test:e2e
npm run package:dir && node test/e2e/packaged.e2e.mjs
```
