# NovelArchive LNReader Plugin (Unofficial)

An [LNReader](https://lnreader.app) plugin for [NovelArchive](https://novelarchive.cc).

> Unofficial. Not affiliated with or endorsed by LNReader or NovelArchive.

## Add to LNReader

In LNReader → **Plugins → Add repository**, paste:

```
https://raw.githubusercontent.com/5ghzx/novelarchive-lnreader/v1.0.0/.dist/plugins.min.json
```

Then install **NovelArchive** from the list.

## What it supports

- Browse: trending, recently-updated (Latest), and filtered (sort, status, genres)
- Search
- Novel info (cover, author, genres, status, summary) and full chapter list
- Chapter reading

## Layout

- `plugins/english/novelarchive.ts` — plugin source
- `public/static/src/en/novelarchive/icon.png` — 96×96 icon
- `.js/src/plugins/english/novelarchive.js` — compiled plugin (served to the app)
- `.dist/plugins.min.json` — repository manifest

## Verification

Built against the live NovelArchive API. `npm run check:plugin` (from
`lnreader/lnreader-plugins`) reports all four checks passing:
`popularNovels`, `searchNovels`, `parseNovel`, `parseChapter`.

## Disclaimer

This plugin scrapes a third-party site that may host copyrighted or machine-translated
content. Use at your own risk and respect the rights of authors and translators.
