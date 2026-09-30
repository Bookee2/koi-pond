# Recorded audio

Drop CC0 / public-domain recordings here and list them in `manifest.json`:

```json
{
  "ambience": [{ "file": "pond-ambience.ogg", "gain": 0.5 }],
  "rain": { "file": "rain-loop.ogg", "gain": 0.6 },
  "plops": ["plop-1.ogg", "plop-2.ogg"],
  "splashes": ["splash-1.ogg"],
  "gulps": ["gulp-1.ogg"]
}
```

Any category left out keeps the synthesised fallback. Keep a `CREDITS.md` next to the files with source and licence for each recording.
