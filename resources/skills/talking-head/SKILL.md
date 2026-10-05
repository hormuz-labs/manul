---
name: talking-head
description: Cleaning up talking videos (vlogs, podcasts, interviews, tutorials): cutting fillers, long pauses, false starts and repeats from the transcript, tight but natural pacing. Read before cutting speech.
---

# Cleaning up talking videos

Work from the `transcript` tool: every word has a start and end time, fillers included.

## What to cut
- **Fillers**: um, uh, erm, ah, hmm (and "like" / "you know" only when the user asks — they often carry meaning).
- **Long pauses**: shorten silences over 0.6 s to about 0.25 s. Don't remove every pause: breathing room after a point
  or before a punchline is pacing, not waste.
- **False starts and repeats**: "So the — so the thing is" → keep the last, complete attempt.
- **Dead air** at the very start and end: begin on the first word (minus 0.15 s), end 0.4 s after the last.

## How to cut
- Plan every cut from word times first, then render once with one ffmpeg command (trim/atrim + concat, or
  select/aselect with `between(t,a,b)`).
- Leave ~0.05 s of air around each cut so words are not clipped; never cut inside a word.
- Many cuts close together read as jumpy: if two cuts are under 0.4 s apart, merge them into one.
- Keep audio and video in sync: cut both with the same ranges.

## After
- Say how much was cut (seconds and how many fillers/pauses) in one line.
- If the result feels too tight or too loose, the user will say; adjust the pause threshold, not the filler list.
