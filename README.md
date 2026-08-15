# Novel Archive — LNReader Plugin (Unofficial)

> ⚠️ Unofficial. Not affiliated with or endorsed by LNReader or Novel Archive.

## ⚠️ AI-generated software

This plugin was generated with AI assistance.

> I understand that AI generated software has a reputation for being of poor
> quality, but I am certain this task was simple enough for AI to handle while
> I focused on other things like reading and enjoying.

## Install

1. In LNReader go to **Plugins → Add repository**.
2. Paste this URL:

   ```
   https://raw.githubusercontent.com/5ghzx/novelarchive-lnreader/main/.dist/plugins.min.json
   ```

3. Tap **Novel Archive** in the list to install it.
4. After install, open the plugin from **Sources** to browse or search.

### Updating

The repository URL always serves the latest build. To get an update, **refresh the
source** (or the repository) in LNReader — the app compares the `version` in the
manifest and offers the update. No need to remove and re-add the repository.

## Features

- **Browse**: trending novels, recently updated ("Latest"), and filtered views
  (sort, status, genres — include/exclude).
- **Search**: by title. Single-token queries with punctuation are normalized
  (e.g. `re:zero` → `rezero`) so the right series comes up first. Multi-word
  queries keep their spaces.
- **Series merge**: Novel Archive returns each volume as a separate entry. The
  plugin collapses volume variants of one series into a single listing (shown
  with the base series title, represented by the lowest volume). When you open
  a merged novel with the **Merge volume variants** setting **on**, the plugin
  rediscovers every sibling volume via search, fetches all their chapters in
  parallel, and assembles them in volume order as one continuous list
  (`Vol. 1 Ch. 1 … Vol. 17 Ch. 15`), so you get the complete series in one
  place. A banner in the summary (`[N volumes merged — M chapters total]`)
  confirms it happened.
- **Skip unavailable chapters**: some chapters are listed but have no text on
  the source (the API returns 404). Two modes, via the **Skip unavailable
  chapters (scan & renumber)** setting:
  - *Off (default)*: unavailable chapters stay listed; opening one silently
    forwards to the next available chapter so reading keeps flowing.
  - *On*: at novel-open the plugin probes every chapter in parallel, drops the
    ones with no text, and renumbers the survivors `1..N` so the list is gap-free.
- **Novel details**: cover, author, genres, status, summary, and the full chapter
  list.

## Repository layout

| Path | Purpose |
|------|---------|
| `plugins/english/novelarchive.ts` | Plugin source (TypeScript) |
| `public/static/src/en/novelarchive/icon.png` | 96×96 plugin icon |
| `.js/src/plugins/english/novelarchive.js` | Compiled plugin served to the app |
| `.dist/plugins.min.json` | Repository manifest (the add-repo URL target) |
| `build-dist.mjs` | Build script: compiles, minifies, writes the manifest |

## Build from source

This repo is a standalone mirror of the plugin. To rebuild the artifacts you need
Node.js ≥ 22 and the `lnreader-plugins` toolchain available (types, `@libs/*`,
terser). From the `lnreader-plugins` checkout:

```bash
# validate the plugin against the live API (all four checks must pass)
npm run check:plugin -- plugins/english/novelarchive.ts

# produce the compiled plugin + manifest
npx tsc --project tsconfig.production.json
node build-dist.mjs
```

`build-dist.mjs` reads the plugin's own `version` field and writes it into the
manifest, so the two never drift.

## Notes & limitations

- The plugin talks to Novel Archive's public JSON API directly; if that API
  changes or goes down, the plugin stops working until updated.
- Novel Archive has no series-aggregate endpoint, so merging volumes requires
  re-searching and per-volume fetches on novel open. This is cached per session
  (library refresh doesn't re-hit the API), and each volume's fetch is capped
  with an 8-second timeout so a single slow/hanging volume can't stall the
  whole novel.
- The eager "skip unavailable" scan probes every chapter on open (bounded to
  64 parallel requests; Novel Archive's server showed no rate limiting up to
  150 parallel). It runs once — the app caches the filtered list.
- This plugin was generated with AI assistance and reviewed against the live
  API. Report issues via the repo's issue tracker.

## ⚠️ Compatibility

This plugin targets **LNReader latest** only. It uses APIs available in recent
runtime builds (e.g. `Promise.withResolvers`) and is verified against the
current app release. It is **not** supported on older LNReader versions;
update the app before installing.

## Disclaimer

This plugin accesses a third-party site that may host copyrighted or
machine-translated content. Use at your own risk and respect the rights of
authors and translators.
