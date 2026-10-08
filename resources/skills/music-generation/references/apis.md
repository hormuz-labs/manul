# Music APIs and the ffmpeg to fit the result

Run these with bash in the project folder. Write each request body with the write tool first (`-d @file` keeps quoting
simple). Never print a key.

## ElevenLabs: compose
`generated/music-bed.json`:
```json
{"model_id": "music_v2_5", "prompt": "Warm lo-fi bed: Rhodes, brushed drums, upright bass, 92 BPM, D minor, steady and calm, lifts slightly at 0:42. Instrumental, no vocals.",
 "music_length_ms": 62000, "force_instrumental": true, "sign_with_c2pa": true}
```
```bash
code=$(curl -sS -X POST "https://api.elevenlabs.io/v1/music" -H "xi-api-key: $ELEVENLABS_API_KEY" \
  -H "Content-Type: application/json" -d @generated/music-bed.json -o generated/music-bed.mp3 -w '%{http_code}')
[ "$code" = 200 ] || { echo "HTTP $code"; cat generated/music-bed.mp3; rm -f generated/music-bed.mp3; }
```
- Output is MP3 (48 kHz 192 kb/s for v2 models); leave `output_format` out.
- `music_length_ms` 3000–600000. `prompt` and `composition_plan` can't be combined; `seed` can't be used with `prompt`.
- If `music_v2_5` is refused (plan or region), use `music_v1`.

## ElevenLabs: score to picture with a composition plan
1. Get a plan (free, no credits, rate limited): `POST https://api.elevenlabs.io/v1/music/plan` with
   `{"prompt": "…", "music_length_ms": 62000, "model_id": "music_v2_5"}`, same headers, saved to
   `generated/music-bed.plan.json`.
2. For v2 models it returns `{"chunks": [{"text", "duration_ms", "positive_styles", "negative_styles", …}]}`.
   - `text` may start with a section name in brackets (`[Intro]`), then lyric lines (≤ 30 lines, ≤ 200 characters
     each). Instrumental: no lyric lines, and `"vocals"` in `negative_styles`.
   - `duration_ms` 3000–120000 per chunk. The first chunk's `positive_styles` set the genre (6–7 styles).
   - Edit the durations so each change lands on a moment of the film (and on a bar at your BPM); keep the total.
3. Compose with `{"model_id": "music_v2_5", "composition_plan": {"chunks": [...]}, "sign_with_c2pa": true}` and the
   compose call above. v2 models keep every chunk's duration exactly.
- `music_v1` plans look different: `positive_global_styles`, `negative_global_styles`, and `sections` of
  `{section_name, positive_local_styles, negative_local_styles, duration_ms, lines}`.

## Google Lyria (Gemini API)
`generated/music-bed.json`:
```json
{"contents": [{"parts": [{"text": "A 65-second instrumental lo-fi track, 92 BPM, D minor: Rhodes, brushed drums, upright bass. [0:00 - 0:12] Intro: Rhodes alone, soft. [0:12 - 0:42] Groove: drums and bass come in. [0:42 - 1:05] Lift: fuller, then resolve on the tonic. Instrumental only, no vocals."}]}],
 "generationConfig": {"responseModalities": ["AUDIO", "TEXT"]}}
```
```bash
curl -sS -X POST "https://generativelanguage.googleapis.com/v1beta/models/lyria-3.5:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" -H "Content-Type: application/json" \
  -d @generated/music-bed.json -o generated/music-bed.response.json
jq -r '.error // empty' generated/music-bed.response.json
jq -r '.candidates[0].content.parts[] | select(.inlineData) | .inlineData.data' generated/music-bed.response.json | base64 -d > generated/music-bed.mp3
jq -r '.candidates[0].content.parts[] | select(.text) | .text' generated/music-bed.response.json   # lyrics / structure
rm generated/music-bed.response.json   # large: the audio is inside it as base64
```
- Models: `lyria-3.5` (full songs, a couple of minutes) and `lyria-3-clip-preview` (always 30 s). Output is MP3;
  `lyria-3.5` can return WAV with `"responseFormat": {"audio": {"mimeType": "audio/wav"}}` in `generationConfig`.
- Length only through the prompt ("a 65-second track") and timestamps (`[0:00 - 0:12] Intro: …`). Section tags
  `[Verse]`, `[Chorus]`, `[Bridge]`; put lyrics apart from the musical direction, in the language they should be sung.
- One shot per request: a generated track can't be edited, only regenerated.
- If generateContent refuses the model, the same models answer on `POST https://generativelanguage.googleapis.com/v1beta/interactions`
  with `{"model": "lyria-3.5", "input": "…"}`; the audio is at
  `.steps[] | select(.type=="model_output") | .content[] | select(.type=="audio") | .data` (base64).

## Fitting the file
Leading silence (the first `silence_end` is where the music starts):
```bash
ffmpeg -hide_banner -i generated/music-bed.mp3 -af silencedetect=n=-50dB:d=0.2 -f null - 2>&1 | grep silence_
```
Trim the start, cut on a bar (at 92 BPM a bar is 240/92 = 2.61 s; 23 bars = 60.0 s) and fade out over the last bar:
```bash
ffmpeg -y -ss 0.18 -i generated/music-bed.mp3 -t 60.0 -af "afade=t=out:st=57.4:d=2.6" -c:a libmp3lame -q:a 2 generated/music-bed-cut.mp3
```
Start the music later in the film (here at 12.5 s), so set_mix can still play the file from 0:
```bash
ffmpeg -y -i generated/music-bed-cut.mp3 -af "adelay=12500:all=1,afade=t=in:st=12.5:d=1" -c:a libmp3lame -q:a 2 generated/music-bed-late.mp3
```
Normalise the track to -14 LUFS so set_mix levels mean the same for every track (one pass is fine for music):
```bash
ffmpeg -y -i generated/music-bed-cut.mp3 -af "loudnorm=I=-14:TP=-1:LRA=11,aresample=48000" -c:a libmp3lame -q:a 2 generated/music-bed-final.mp3
```
Then `import_media` the final file and `set_mix` with it.
