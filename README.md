# NovelArchive LNReader Plugin (Unofficial)

An [LNReader](https://lnreader.app) plugin for [NovelArchive](https://novelarchive.cc).

> Unofficial. Not affiliated with or endorsed by LNReader or NovelArchive.

## ⚠️ AI-generated software

This plugin was generated with AI assistance.

> I understand that AI generated software has a reputation for being of poor
> quality, but I am certain this task was simple enough for AI to handle while
> I focused on other things like reading and enjoying.

## Add to LNReader

In LNReader → **Plugins → Add repository**, paste:

```
https://raw.githubusercontent.com/5ghzx/novelarchive-lnreader/main/.dist/plugins.min.json
```

Then install **NovelArchive** from the list. Updates are automatic: the same
URL always serves the latest plugin, and the app offers an update whenever the
`version` in the manifest increases. You do not need to re-add the repository.

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

## Contributing to the official repo

To submit this to `lnreader/lnreader-plugins`, open a PR with
`plugins/english/novelarchive.ts`. The maintainers require `npm run check:plugin`
to pass (it does) and may ask you to explain the code — be ready to stand behind it.
