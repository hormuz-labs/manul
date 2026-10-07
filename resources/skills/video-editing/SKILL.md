---
name: video-editing
description: How to edit any video well: the opening seconds, pacing and where to cut, shot length, sound (music under speech, clean audio cuts, loudness), picture (vertical reframing, text and faces, captions), export, and checking a render before proposing it. Read before any edit beyond a single trim; talking-head and motion-design add to it.
---

# Editing a video well

Edits are judged by people who watch for a few seconds and leave if bored, confused or annoyed by the sound.
Every rule here comes from that. Numbers are defaults: when the user asks for something else, do that.

## 1. Before cutting
- Know the goal: who watches, where (YouTube, Shorts/Reels/TikTok, a website, a meeting), how long it should be.
  If the user didn't say and it changes the edit, ask once with `ask_user`; otherwise pick the obvious default.
- Know the material: `project_state` and `probe` for size, fps, length and audio; the `transcript` for speech;
  shot changes from `ffmpeg -i in.mp4 -vf "select='gt(scene,0.3)',showinfo" -f null -` (see references/ffmpeg.md).
- Plan the whole edit as a list of kept ranges (source in–out, in order) before running anything. Render once.

## 2. Structure
- **The first 3 seconds decide everything.** Open on the strongest moment: the result, the surprise, the face, the
  line that makes the promise. No logos, no "hi guys", no slow fade from black, no title card first.
- **The opening must deliver what the title/thumbnail promised**, within about 15 s. Viewers who don't see it leave.
- For long videos a short teaser of the best moments (cut on beats, 10–60 s) before the calm start works well.
- In a story, opening on the payoff means a short flash-forward (1–3 s, e.g. the punchline line), then the story in
  its own order. Don't scramble the order of events otherwise.
- Every 1–2 minutes give a reason to keep watching: a question, a turn, "but then…". Cut anything that repeats.
- End cleanly: the last line or image, then at most 1–2 s of hold. No long outro unless asked.
- Keep the user's words and order when they gave a script. Don't shorten their content to hit a length unless asked.

## 3. Pacing: energy comes from cuts, not effects
- **More energy = more cuts, cut on words and beats, bigger subjects in frame.** Never add camera shake, flashes,
  glitches, RGB splits, blur pulses or random zooms to "add energy": they look cheap and tire viewers.
- Shot length: talking/explaining 3–8 s; b-roll and footage 2–6 s (one camera move per shot); fast montage 0.5–2 s
  only for short bursts. A shot under ~0.3 s (fewer than ~8 frames) reads as a glitch: remove it or extend it.
- Vary the *kind* of shot and motion (wide/close, still/moving, face/b-roll). The same pattern every 5 s feels dull.
- Cut **on**: the start of a word or sentence, a musical beat, the peak of an action (match on action), a look or turn.
  Don't cut in the middle of a camera move, a word, or a gesture that is about to land.
- **J and L cuts**: let the next shot's sound start 0.2–0.5 s before its picture (J), or the old sound run
  under the new picture (L). It makes cuts feel smooth; straight cuts on both are for hard punctuation.
- Jump cuts in a talking head are fine when deliberate; to hide one, alternate framing (e.g. 100 % and a 115 % crop
  on the face) — never zoom so far that heads or text are cut off.
- Hold on what matters: a reaction, a punchline, a reveal gets an extra 0.5–1 s. Pauses are pacing, not waste.

## 4. Sound (people forgive a bad picture, never bad sound)
- **Speech is king.** Voice must be clearly on top: music and effects sit at least ~10 dB below speech
  (`set_mix` duck_db 8–14). Use a steady dip under whole phrases — music that jumps back up between every phrase
  (pumping) is the most common complaint.
- Music with no speech over it can come up (it's a moment, not a bed). Fade music in/out (≥ 1 s), and cut music
  on a beat or bar, never mid-note.
- **Every audio cut gets a short crossfade (10–30 ms)** or it clicks. Cut speech only on word boundaries (the
  transcript's word start/end), never inside a word. Fill removed gaps with the room's own quiet, not digital silence.
- Don't add reverb or echo to voices. Don't stack effects on speech.
- Sound effects: a few big ones (whoosh on a transition, a hit on a reveal, ambience). Never repeat small
  pops/pings/dings on every cut or text — audiences find them grating.
- Loudness for delivery: **-14 LUFS integrated, true peak ≤ -1 dBTP** for YouTube/social/web (podcast audio: -16 LUFS).
  Measure with `ebur128`, normalise with two-pass `loudnorm` (references/ffmpeg.md). Never clip.
- Use only music the user provided or owns the rights to; don't fetch random songs. Original music made for the film
  is fine: read the music-generation skill.

## 5. Picture
- **Nothing over faces**: text, captions, logos and lower thirds go in the free space, not across eyes or mouths.
- Vertical (9:16) from horizontal: crop to the subject (follow the speaker/face), don't letterbox with a blurred copy
  unless asked. Keep important things out of the platform UI zones: top ~12 % and bottom ~22 % of the frame.
- Text on screen: short (≤ 6–8 words), on screen long enough to read twice (~0.3 s per word, at least 1.5 s),
  large (readable on a phone), high contrast. Text cards should be the exception (≤ ~10 % of runtime).
- Captions/subtitles: 1–2 lines, ≤ ~32 characters per line, split at phrase boundaries, timed to the words.
  Burned-in captions help muted social viewing; ask before adding them if the user didn't say.
- Screens and slides: don't zoom or crop so that text or the speaker's inset is cut at the frame edge.
- Never leave frozen frames, black frames or flashes of the wrong shot at cut points (check — section 7).
- Keep colour consistent between shots; correct only obvious problems (too dark, wrong white balance). No heavy LUTs
  unless asked.

## 6. Export
- Keep the source frame rate. Don't scale the whole film above its source size unless asked; a 9:16 crop of a
  1080p source scaled to 1080×1920 is normal for social. One finished version, not a set of alternates (unless asked).
- Default: H.264 (`libx264 -crf 18 -preset medium -pix_fmt yuv420p`), AAC 192 kb/s 48 kHz, `-movflags +faststart`.
  Sizes: 1920×1080 (16:9), 1080×1920 (9:16), 1080×1080 (1:1). Use `export_video` for these presets.

## 7. Check before proposing
Run the checks in references/checks.md on the render (one ffmpeg pass each, fast): duration as planned, no black
frames, no frozen frames, no unintended silence, loudness on target, and look at a frame from the start, the middle
and each tricky cut. Fix what fails, then `propose_version` once, saying in one line what changed.

## 8. Taking notes from the user
- A note on a moment means *that* moment: change it and as little else as possible.
- When the user corrects how something should be done for good ("never use that transition"), remember it
  (`remember`) or update the skill (`fork_skill`), so the next edit gets it right.
