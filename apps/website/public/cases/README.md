# Case recordings

The "In practice" section (`#cases`) plays a short screen recording for each entry in
[`src/content/cases.ts`](../../src/content/cases.ts). An entry without a recording shows a "Recording
soon" test card, so the page looks finished at every stage. This folder holds the files; the page
reads `/cases/<id>.mp4` and `/cases/<id>.jpg`.

## 1. Record

Each case has a `frame`:

- `screen`: the whole display, shown at 16:10.
- `panel`: just the panel (420 × 580 pt), shown upright on a dot-grid stage.

Before you record:

- Use a black or very dark wallpaper. The site is black, so the panel's rounded corners and any
  letterboxing disappear into the card.
- Clear the desktop and quit apps that should not appear. Turn on a Focus so other notifications stay
  out of the shot; for the automation case, allow Atd's notifications.
- Keep the panel at its default size (420 × 580 pt) and position.
- Show only data you are happy to publish: no keys, tokens, private repositories, email addresses or
  personal paths, in the conversation or in terminal output.
- Aim for 20–60 seconds of one continuous task. Trim the idle time at the start and the end.

To record, press ⌘ ⇧ 5 and choose Record Entire Screen. Under Options, set Microphone to None. Record
the whole screen for `panel` cases too: the panel is cut out exactly in step 2. On a Retina display the
recording has twice the point size in pixels, which is what the commands below expect.

## 2. Export

| Frame    | Size                                   | Video                                                                        |
| -------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `screen` | 1920 × 1200, or 2560 × 1600 for detail | H.264 High, yuv420p, 30 fps (60 for scrolling), no audio track, `+faststart` |
| `panel`  | 840 × 1160 (2× the panel) or larger    | same                                                                         |

Keep each file at or under about 15 MB. Run the commands from `apps/website`, with `<id>` replaced by
the case's `id` and `raw.mov` by your recording.

`screen`: fit the recording into 1920 × 1200. A display that is not exactly 16:10 (most MacBooks are
slightly taller) gets thin black bars that blend into the card.

```sh
ffmpeg -i raw.mov -an \
  -vf "fps=30,scale=1920:1200:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1200:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p" \
  -c:v libx264 -preset slow -crf 24 -profile:v high -movflags +faststart \
  public/cases/<id>.mp4
```

`panel`: cut the panel out of the full-screen recording. With the Dock hidden, the panel sits 16 pt
from the right and bottom edges, so on a Retina display its 840 × 1160 pixels start 872 pixels from
the right and 1192 from the bottom. Check the cut on one frame first and adjust the two offsets if a
sliver of desktop shows (for example, when the Dock is visible):

```sh
ffmpeg -ss 2 -i raw.mov -frames:v 1 -vf "crop=840:1160:iw-872:ih-1192" check.png && open check.png

ffmpeg -i raw.mov -an \
  -vf "crop=840:1160:iw-872:ih-1192,fps=30,format=yuv420p" \
  -c:v libx264 -preset slow -crf 22 -profile:v high -movflags +faststart \
  public/cases/<id>.mp4
```

To trim, put `-ss <start> -to <end>` (for example `-ss 3 -to 41`) before `-i`. If a file comes out
larger than 15 MB, raise `-crf` by 2 and export again, or trim it.

Poster: the first frame, at the video's size, at most 200 KB. Raise `-q:v` (up to about 6) if it is
larger.

```sh
ffmpeg -i public/cases/<id>.mp4 -frames:v 1 -q:v 3 public/cases/<id>.jpg
```

A WebP poster is smaller: export the frame as PNG, then convert it with `cwebp` (Homebrew `webp`).

```sh
ffmpeg -i public/cases/<id>.mp4 -frames:v 1 frame.png && cwebp -q 80 frame.png -o public/cases/<id>.webp
```

Running time, in seconds, for the card's `m:ss` label:

```sh
ffprobe -v error -show_entries format=duration -of csv=p=0 public/cases/<id>.mp4
```

Optional AV1 rendition: usually a good deal smaller at the same quality, played by Chrome and Firefox,
and by Safari on Macs that decode AV1 in hardware (M3 and later). Every other browser plays the MP4, which stays
required. Use the same `-vf` filter as the MP4:

```sh
ffmpeg -i raw.mov -an -vf "<the same filter as the MP4>" \
  -c:v libsvtav1 -preset 6 -crf 36 public/cases/<id>.webm
```

## 3. Show it on the page

In `src/content/cases.ts`, find the entry with the same `id` (or copy one), rewrite `title`,
`summary` and `tags` in both languages to describe what the recording shows, and add `video`:

```ts
video: {
  src: '/cases/<id>.mp4',
  poster: '/cases/<id>.jpg',
  duration: '0:42',
  av1: '/cases/<id>.webm', // only if you made one
},
```

Run `pnpm dev` and open `/#cases` to check it. If a file cannot be loaded, the card falls back to its
test card and the browser console names the case.

## Large files

Everything in this folder ships with the site and stays in the Git history. A few clips at or under
15 MB are fine; for more, or larger ones:

- **Vercel Blob**: upload with `vercel blob put public/cases/<id>.mp4 --pathname cases/<id>.mp4
--access public` (and the same for the poster), then use the returned URLs as `src` and `poster`.
  Absolute URLs work anywhere a path does. Do not commit the uploaded files.
- **Git LFS**: `git lfs track "apps/website/public/cases/*.mp4"` and commit the resulting
  `.gitattributes`. Make sure the Vercel project fetches LFS files (its Git settings have a Git LFS
  option); otherwise the deployment serves pointer files instead of videos.
