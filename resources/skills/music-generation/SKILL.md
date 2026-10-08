---
name: music-generation
description: Making original music for a film with ElevenLabs Music or Google Lyria: when to generate, writing the brief from the edit (mood, BPM, length, sections that hit the cuts), the API calls, checking the track and fitting it under the picture with set_mix. Read before generating or scoring music; video-editing covers the mix.
---

# Generating music for a film

Music made for this film, to its length and its moments, beats a stock track looped under it. The commands are in
references/apis.md. Numbers are defaults: when the user asks for something else, do that.

## 1. When
- The user asks for music, a score, a bed, a sting or a jingle; or the edit clearly needs music and none was provided.
  Generated music is original, so it passes video-editing's rule on rights. Music the user provided always wins.
- Never ask for a named artist, song or voice ("like Hans Zimmer", "Blinding Lights"): the APIs block it, and it
  isn't ours to copy. Describe the sound instead (instruments, tempo, mood, era).
- Each generation costs the user credits. If they didn't ask for generated music themselves, ask once with `ask_user`
  (which provider, how long). Make **one take**; offer another instead of making several unasked.

## 2. Provider
Check the keys with `[ -n "$ELEVENLABS_API_KEY" ]` and `[ -n "$GEMINI_API_KEY" ]`. Never echo, log or write a key.
- **ElevenLabs Music (preferred):** exact length (3 s–10 min), guaranteed instrumental, and a composition plan
  whose sections last exactly as long as you say, so the music can change on the cut.
- **Google Lyria:** `lyria-3.5` makes full songs of a couple of minutes; length only through the prompt and
  timestamps. `lyria-3-clip-preview` always makes 30 s: good for stings, loops and trying out a brief.
- Neither key: say in one line which key unlocks it (Settings → Keys: ElevenLabs or Google Gemini) and stop. Don't
  browse for random music instead. OpenAI has no music API.

## 3. The brief comes from the film
- Read the film first: `analyze_video` (duration, every shot's cut time, silences, loudness) and the `transcript`
  (where speech is and where it stops). Write down the moments the music should answer: the opening, the reveal, the last line.
- **Role:**
  - Bed under speech: instrumental, sparse, no lead melody or vocals fighting the voice, steady energy.
  - Moment with no speech (montage, reveal, product shot): the music can carry the melody and come up.
  - Sting or transition: 2–5 s with a clear hit. Intro/outro: short, ends on a resolved chord.
- **Who leads?** (video-editing's music-sync.md) For a montage/promo the music comes FIRST and the picture is cut to it:
  generate the length the film should be, with sections where the story turns, then cut to the beats you measure. For
  a speech-led film the picture is fixed: generate to its length with sections at its moments.
- **Length**: the film's length + 2 s (trim the extra on a bar at the end), so set_mix never loops it (a loop seam is
  audible). Ask for a real ending ("ends on a final hit and a ringing chord"), not a fade. Longer than 10 min: generate
  in parts that hand over on a section change.
- **Fix a BPM in the brief.** In 4/4 a bar lasts 240/BPM s (120 BPM → 2 s), so you can place section changes on the
  film's moments and cut or end the music on a bar instead of mid-note.
- **Score to picture:** sections that follow the film (quiet intro under the opening lines, lift at the reveal, resolve
  under the last line). ElevenLabs: a composition plan with section durations; Lyria: timestamps in the prompt.
- **Prompt:** genre, mood, lead instruments, BPM, key, the energy curve, and "instrumental, no vocals" unless the user
  wants singing. Concrete words ("warm Rhodes, brushed drums, upright bass, 92 BPM, D minor, builds at 0:42"), not
  adjectives like "epic" or "cinematic" alone.

## 4. Generate
- Write the request body with the write tool to `generated/music-<slug>.json`: it keeps the curl quoting simple and is
  the record of what was asked. Then run the call in references/apis.md and save `generated/music-<slug>.mp3`.
- On a failure read the error once and fix the cause: 401 = key, 422 = a field (the body says which), 429 = rate
  limit (wait, then try once), a safety block = reword the prompt (usually a name). No retry loops.

## 5. Check before using it
- `analyze_music` it: the real BPM, the bars, where the lifts and drops actually fell, the hits, and the beats file.
  Generated music is never exactly the BPM or section times you asked for — **cut to what you measured**, not to the
  brief. If a planned big moment (the reveal) misses the music's lift by more than a beat, move the cut to the lift, or
  slide the music, or regenerate with adjusted section lengths.
- `probe` it: the duration is what you asked for (Lyria's isn't exact: trim on a bar with a fade, or regenerate).
- Leading silence (`silencedetect`): trim it so the music starts on time.
- Loudness: normalise the track to -14 LUFS (references/apis.md) so set_mix levels mean the same for every track.
- Lyria isn't guaranteed instrumental. The `transcript` of the file hints at vocals, but whisper makes up a few words on
  any music: only real sung lines count.

## 6. Fit it under the picture
- `import_media` the file, then `set_mix`: under speech db -18 to -12, duck_db 8–14; a film with no speech can sit
  near -6. Speech stays on top (video-editing §4).
- set_mix plays the music from 0 to the end (looped if short, 1 s fade in, 2 s fade out). For music that starts
  later, stops early or changes at a moment, prepare the file with ffmpeg first (silence before it, a cut on a bar, a
  fade) and set_mix that file.
- Cutting picture to it: follow video-editing's music-sync.md — cuts on measured beats, big moments on lifts and hits,
  the end card on the final hit, the music ending with the picture.

## 7. Say what it is
- One line: it's generated, by which provider and model, and how long. ElevenLabs tracks are signed with C2PA
  (`sign_with_c2pa`); Lyria tracks carry a SynthID watermark.
- Rights follow the user's plan with that provider. If the film is for a client or ads, say so once.
- When the user corrects the music for good ("never vocals", "always lo-fi"), `remember` it.
