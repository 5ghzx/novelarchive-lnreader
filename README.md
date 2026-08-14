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
- **Series de-duplication**: Novel Archive returns each volume as a separate entry.
  The plugin collapses volume variants of the same series into one listing (the
  volume with the most chapters), so you don't get ten "Re:Zero Vol. N" rows.
- **Novel details**: cover, author, genres, status, summary, and the full chapter
  list.
- **Reading**: chapter content is fetched and rendered in the reader.

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
- Volume merging is a search/browse convenience. Opening a listing opens that
  volume's chapters; Novel Archive has no series-aggregate endpoint, so cross-volume
  chapter stitching is intentionally not done.
- This plugin was generated with AI assistance and reviewed against the live API.
  Report issues via the repo's issue tracker.

## Disclaimer

This plugin accesses a third-party site that may host copyrighted or
machine-translated content. Use at your own risk and respect the rights of
authors and translators.
