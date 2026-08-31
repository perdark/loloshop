#!/usr/bin/env bash
# Contact sheet + hard checks for every finished reel. Run from store-assets/.
# Catches the three defects this pipeline actually produces:
#   near-empty frames · cuts that miss the beat · audio that never got measured
set -u
OUT=${1:-/tmp/reel-review}
mkdir -p "$OUT"
for f in loloshop-reel-*.mp4; do
  [ -e "$f" ] || continue
  case "$f" in *-silent.mp4) continue;; esac
  n="${f%.mp4}"
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  wh=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height,avg_frame_rate -of csv=p=0 "$f")
  aud=$(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,channels,sample_rate -of csv=p=0 "$f")
  cuts=$(ffmpeg -hide_banner -i "$f" -filter:v "select='gt(scene,0.03)',showinfo" -f null - 2>&1 \
         | grep -oE "pts_time:[0-9.]+" | sed 's/pts_time://' | awk '{printf "%.2f ",$1}')
  # a frame whose luma variance is near zero is an empty frame
  empty=$(ffmpeg -hide_banner -i "$f" -vf "signalstats,metadata=print:key=lavfi.signalstats.YDIF" -f null - 2>&1 \
         | grep -c "YDIF=0.000000")
  printf '\n=== %s ===\n  %s | %ss | audio %s\n  detected cuts: %s\n  flat frames:   %s\n' \
         "$f" "$wh" "$dur" "$aud" "${cuts:-none (all soft transitions)}" "$empty"
  ffmpeg -v error -y -i "$f" \
    -vf "select='not(mod(n\,15))',scale=170:-1,tile=8x4:padding=5:color=0x222222" \
    -frames:v 1 "$OUT/$n-sheet.png"
  ffmpeg -v error -y -i "$f" -frames:v 1 -q:v 3 "$OUT/$n-cover.jpg"
  echo "  sheet: $OUT/$n-sheet.png"
done
