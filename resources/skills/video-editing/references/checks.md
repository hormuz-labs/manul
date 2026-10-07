# Checks before proposing a render

Each is one fast ffmpeg pass (seconds even for long films). Run them on the render, fix what fails, then propose.

| Check | Command | Pass when |
|---|---|---|
| Length and streams | `ffprobe -v error -show_entries stream=codec_type,duration -of csv=p=0 renders/out.mp4` | video and audio both there, same length (±0.1 s), length as planned |
| Black frames | `ffmpeg -hide_banner -i renders/out.mp4 -vf "blackdetect=d=0.1:pix_th=0.10" -an -f null - 2>&1 \| grep black_start` | nothing, or only blacks you put there on purpose |
| Frozen picture | `ffmpeg -hide_banner -i renders/out.mp4 -vf "freezedetect=n=0.003:d=0.5" -an -f null - 2>&1 \| grep -E "freeze_(start\|end)"` | nothing, except intended stills, title cards, slides and the black parts above (they register as frozen too) |
| Dead sound | `ffmpeg -hide_banner -i renders/out.mp4 -af "silencedetect=n=-45dB:d=0.4" -vn -f null - 2>&1 \| grep -E "silence_(start\|end)"` | only intended pauses; a silence at a cut point means a range was cut wrong |
| Loudness | `ffmpeg -hide_banner -i renders/out.mp4 -af "ebur128=peak=true" -vn -f null - 2>&1 \| grep -E "^ +(I\|Peak):"` | I about -14 LUFS (±1) for web/social, Peak ≤ -1 dBFS |
| Shot lengths | the scene command in ffmpeg.md on the render | no shot shorter than ~0.3 s unless it is a deliberate burst |

Then look: grab frames (ffmpeg.md, "Still frame") at 1 s, the middle, and 0.2 s after each tricky cut, and read them:
nothing over faces, text not cut by the frame edge, the subject inside a vertical crop, no wrong shot flashing in.

If speech was cut, read the `transcript` of the render at the cut points: every word whole, nothing doubled.
