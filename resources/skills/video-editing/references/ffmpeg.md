# ffmpeg recipes for editing

All tested with Manul's bundled ffmpeg. Replace `in.mp4`, times (seconds) and sizes. Put the whole edit in ONE command.

## Find the shots
```bash
ffmpeg -hide_banner -i in.mp4 -vf "select='gt(scene,0.3)',showinfo" -an -f null - 2>&1 | grep -o "pts_time:[0-9.]*"
```
Each time is a cut in the source. Lower 0.3 to find softer cuts, raise it if camera moves show up as cuts.

## Keep ranges (the core of every edit)
Keep 0.5–2.5 and 3.0–4.0, with 15 ms audio fades at every edge so cuts never click
(fade out starts at segment length − 0.015):
```bash
ffmpeg -y -i in.mp4 -filter_complex "\
[0:v]trim=0.5:2.5,setpts=PTS-STARTPTS[v0];[0:a]atrim=0.5:2.5,asetpts=PTS-STARTPTS,afade=t=in:d=0.015,afade=t=out:st=1.985:d=0.015[a0];\
[0:v]trim=3.0:4.0,setpts=PTS-STARTPTS[v1];[0:a]atrim=3.0:4.0,asetpts=PTS-STARTPTS,afade=t=in:d=0.015,afade=t=out:st=0.985:d=0.015[a1];\
[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]" -map "[v]" -map "[a]" \
-c:v libx264 -crf 18 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart renders/out.mp4
```
Add one `[vN]…[aN]` pair per kept range and set `concat=n=` to the count. Several input files: `-i a.mp4 -i b.mp4`
and use `[1:v]`, `[1:a]` for the second one (all parts must have the same size and fps — scale/fps them first).

## J cut / L cut (sound and picture change at different times)
Picture A 0–2 then B 3–5, but B's sound starts 0.3 s early (J cut). Cut video and audio separately; each side
must add up to the same length:
```bash
ffmpeg -y -i in.mp4 -filter_complex "\
[0:v]trim=0:2,setpts=PTS-STARTPTS[v0];[0:a]atrim=0:1.7,asetpts=PTS-STARTPTS,afade=t=out:st=1.685:d=0.015[a0];\
[0:v]trim=3:5,setpts=PTS-STARTPTS[v1];[0:a]atrim=2.7:5,asetpts=PTS-STARTPTS,afade=t=in:d=0.015[a1];\
[v0][v1]concat=n=2:v=1:a=0[v];[a0][a1]concat=n=2:v=0:a=1[a]" -map "[v]" -map "[a]" \
-c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac renders/out.mp4
```
L cut: the same with A's audio running 0.3 s longer and B's audio starting 0.3 s later.

## Crossfade between two shots (use sparingly: time passing, a mood change)
```bash
ffmpeg -y -i a.mp4 -i b.mp4 -filter_complex \
"[0:v][1:v]xfade=transition=fade:duration=0.5:offset=<length of a − 0.5>[v];[0:a][1:a]acrossfade=d=0.5[a]" \
-map "[v]" -map "[a]" -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac renders/out.mp4
```

## Vertical 9:16 from 16:9, framed on the subject
`0.4` = where the subject's centre is, as a fraction of the width (0 left … 1 right). The min/max keeps the crop inside
the frame. Different shots usually need different centres: crop each kept range on its own.
```bash
ffmpeg -y -i in.mp4 -vf "crop=w=ih*9/16:h=ih:x='max(0,min(iw-ow,iw*0.4-ow/2))':y=0,scale=1080:1920:flags=lanczos,setsar=1" \
-c:v libx264 -crf 18 -pix_fmt yuv420p -c:a copy renders/vertical.mp4
```

## Music under speech (prefer `set_mix`, which ducks and loops for you)
When music must be mixed in a render: a smooth duck (slow attack/release, so it doesn't pump between words):
```bash
ffmpeg -y -i film.mp4 -i music.mp3 -filter_complex \
"[0:a]asplit=2[voice][key];[1:a]volume=0.5,afade=t=in:d=1[m];[m][key]sidechaincompress=threshold=0.02:ratio=6:attack=80:release=1200[duck];\
[voice][duck]amix=inputs=2:normalize=0:duration=first[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k renders/mixed.mp4
```

## Loudness to -14 LUFS, true peak -1 dBTP (two passes)
Pass 1 measures:
```bash
ffmpeg -hide_banner -i in.mp4 -af "loudnorm=I=-14:TP=-1:LRA=11:print_format=json" -vn -f null - 2>&1 | sed -n '/^{/,/^}/p'
```
Pass 2 uses the numbers it printed (input_i, input_tp, input_lra, input_thresh, target_offset):
```bash
ffmpeg -y -i in.mp4 -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=<input_i>:measured_TP=<input_tp>:measured_LRA=<input_lra>:measured_thresh=<input_thresh>:offset=<target_offset>:linear=true,aresample=48000" \
-c:v copy -c:a aac -b:a 192k renders/final.mp4
```
Do it last, on the finished mix. Podcasts: I=-16.

## Still frame to look at
```bash
ffmpeg -y -ss 12.5 -i renders/out.mp4 -frames:v 1 -q:v 3 notes/check-12.5.jpg
```
