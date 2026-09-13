import { fetchText, fetchApi } from '@libs/fetch';
import { storage } from '@libs/storage';
import { Plugin } from '@/types/plugin';
import { Filters, FilterTypes } from '@libs/filterInputs';
import { load as parseHTML, type CheerioAPI } from 'cheerio';
import { defaultCover } from '@libs/defaultCover';

// Module-level (not instance) cache: LNReader may re-instantiate the plugin
// object between calls, wiping instance fields — that re-downloaded the whole
// ~1.8 MB / 884-card library page on every Browse page. Survives as long as
// the module stays loaded in the app session.
type LibraryEntry = { novel: Plugin.NovelItem; author: string; tags: string[] };

let libraryCache: { items: LibraryEntry[]; at: number } | null = null;

class LnoriComPlugin implements Plugin.PluginBase {
  id = 'lnori-com';
  name = 'LNORI.com';
  icon = 'src/en/lnori/icon.png';
  site = 'https://lnori.com/';
  // Required by the app's PluginItem: the UPDATE path copies name/site/lang
  // from this evaluated module back into the stored plugin row.
  lang = 'English';
  version = '1.0.22';
  pluginSettings = {
    mergeCoverTitle: {
      label: 'Merge cover + title page into one entry',
      type: 'Switch',
      value: true,
    },
    relayFallback: {
      label: 'Fallback fetch via browser-render relay (fixes timeouts)',
      type: 'Switch',
      value: true,
    },
  };
  // Network layer: one patient fetch per page, app-default headers, NO
  // retries against the site itself, NO multi-request bursts — retry storms
  // and parallel bursts are what push lnori.com's rate score into its tarpit
  // penalty box (the reported "works right after install, then times out
  // forever" pattern). Direct fetch first; when the site tarpits or shells
  // the request, ONE transparent fallback through a browser-render relay
  // (see fetchViaRelay). Beyond that we AVOID REQUESTS: every page is cached
  // persistently (MMKV via the app's plugin storage — survives app restarts,
  // which is where the old module-level cache died and re-downloaded the
  // 1.8 MB library every session) and served stale whenever the site
  // misbehaves.
  private static readonly FETCH_TIMEOUT_MS = 60000;
  private static readonly LIBRARY_TTL_MS = 7 * 24 * 3600 * 1000;
  private static readonly SERIES_TTL_MS = 12 * 3600 * 1000;
  private static readonly VOLUME_TTL_MS = 24 * 3600 * 1000;
  // Chapter pages are immutable once published.
  private static readonly CHAPTER_TTL_MS = 30 * 24 * 3600 * 1000;

  // Freshness lives INSIDE the value because the app's storage.get() deletes
  // expired entries on read — using its expires param would make stale data
  // unavailable exactly when we need it (site down / penalty box active).
  private cacheGet<T>(key: string, ttlMs: number): { data: T; stale: boolean } | null {
    try {
      const hit = storage.get(key) as { v: T; at: number } | undefined;
      if (!hit || typeof hit.at !== 'number' || hit.v == null) return null;
      return { data: hit.v, stale: Date.now() - hit.at > ttlMs };
    } catch {
      return null; // corrupted entry — treat as missing
    }
  }

  private cacheSet<T>(key: string, data: T): void {
    try {
      storage.set(key, { v: data, at: Date.now() });
    } catch {
      /* caching is best-effort */
    }
  }

  // Every real lnori page carries at least one of these markers (library →
  // data-t= on cards, series → hero-card/s-title, volume → toc-view, chapter
  // → section class="chapter"). A response lacking ALL of them is a bot-check
  // shell, a soft-404, or a truncated body — never a usable page.
  private static readonly PAGE_MARKERS =
    /class="s-title"|class="hero-card"|toc-view|section class="chapter"|data-t=/;
  // Browser-render relay (r.jina.ai, free tier): renders the target page in a
  // real headless Chrome and returns the resulting HTML. lnori.com's zone
  // silently tarpits the APP's requests (verified byte-for-byte through a USB
  // tunnel: TLS handshake + request go out, zero response bytes come back)
  // while browsers on the same network pass — so when the direct fetch fails
  // or returns a shell, we re-fetch through the relay, whose requests are
  // real Chrome and immune to that fingerprint rule. The direct path stays
  // primary (fastest, no third party) whenever the site answers it.
  private static readonly RELAY_PREFIX = 'https://r.jina.ai/';
  // Free-tier relay budget is 20 requests / 60s (x-ratelimit headers). Stay
  // under it ourselves so a first full-series parse (N volume pages) can't
  // trip 429s — self-throttle to 18/min.
  private static readonly RELAY_MAX_PER_MIN = 18;
  // Once a direct fetch exhibits the tarpit signature (timeout or bot-check
  // shell), skip the direct path entirely for a while: otherwise every page
  // of a multi-volume parse would burn its full direct window before
  // falling back (~45s x N volumes). Ten minutes, refreshed on each new
  // tarpit hit; a direct success clears it.
  private static DIRECT_DOWN_MS = 10 * 60000;
  private static directDownUntil = 0;
  private static relayLog: number[] = [];

  // Wait until the relay's 60s window has budget for one more request.
  private async throttleRelay(): Promise<void> {
    const now = Date.now();
    LnoriComPlugin.relayLog = LnoriComPlugin.relayLog.filter(
      t => now - t < 60000,
    );
    if (LnoriComPlugin.relayLog.length >= LnoriComPlugin.RELAY_MAX_PER_MIN) {
      const wait = 60000 - (now - LnoriComPlugin.relayLog[0]) + 500;
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    LnoriComPlugin.relayLog.push(Date.now());
  }

  private async fetchViaRelay(url: string): Promise<string> {
    // x-return-format: html — without it the relay returns markdown text.
    // fetchApi applies the app's default headers; nothing about the device
    // leaks beyond what a normal page view would send.
    await this.throttleRelay();
    const res = await fetchApi(LnoriComPlugin.RELAY_PREFIX + url, {
      headers: { 'x-return-format': 'html' },
    });
    if (res.status === 429) {
      // Shared free tier can still 429 under us — one polite retry after a
      // short wait instead of failing the page.
      await new Promise(r => setTimeout(r, 15000));
      const retry = await fetchApi(LnoriComPlugin.RELAY_PREFIX + url, {
        headers: { 'x-return-format': 'html' },
      });
      if (!retry.ok) throw new Error(`relay HTTP ${retry.status}`);
      return retry.text();
    }
    if (!res.ok) {
      throw new Error(`relay HTTP ${res.status}`);
    }
    return res.text();
  }

  private describe(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    return msg.length > 160 ? msg.slice(0, 160) + '…' : msg;
  }

  private static withTimeout<T>(
    p: Promise<T>,
    ms: number,
    what: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
      p.then(
        v => {
          clearTimeout(t);
          resolve(v);
        },
        e => {
          clearTimeout(t);
          reject(e instanceof Error ? e : new Error(String(e)));
        },
      );
    });
  }

  private async fetchPage(url: string): Promise<string> {
    // Direct leg first (45s cap): fastest and no third party when the site
    // answers. On any failure — timeout, empty shell, bot-check — fall back
    // to the browser-render relay, which sidesteps the site's fingerprint
    // tarpit entirely. No automatic retries against lnori.com itself: retry
    // storms are what earn the tarpit in the first place. Call sites serve
    // stale cache when this ultimately throws.
    let directError: unknown;
    if (Date.now() >= LnoriComPlugin.directDownUntil) {
      try {
        const body = await LnoriComPlugin.withTimeout(
          Promise.resolve(fetchText(url)),
          45000,
          `Direct fetch of ${url}`,
        );
        if (LnoriComPlugin.PAGE_MARKERS.test(body)) {
          LnoriComPlugin.directDownUntil = 0; // direct is healthy again
          return body;
        }
        directError = new Error(
          `site returned an unusable page (bot-check shell)`,
        );
        // Shell = the bot rule, not a one-off. Stop feeding it requests.
        LnoriComPlugin.directDownUntil =
          Date.now() + LnoriComPlugin.DIRECT_DOWN_MS;
      } catch (e) {
        directError = e;
        if (/timed out/i.test(e instanceof Error ? e.message : String(e))) {
          LnoriComPlugin.directDownUntil =
            Date.now() + LnoriComPlugin.DIRECT_DOWN_MS;
        }
      }
    } else {
      directError = new Error('direct skipped (tarpit breaker active)');
    }
    const direct = this.describe(directError);
    if (storage.get('relayFallback') === false) {
      throw new Error(`LNORI.com direct fetch failed (${direct}): ${url}`);
    }
    // Relay leg gets its own generous budget: it may have to wait out the
    // 20/min throttle before even sending (worst ~60s) plus render time.
    const budget = 105000;
    try {
      const relayBody = await LnoriComPlugin.withTimeout(
        this.fetchViaRelay(url),
        budget,
        `Relay fetch of ${url}`,
      );
      if (LnoriComPlugin.PAGE_MARKERS.test(relayBody)) return relayBody;
      throw new Error('relay returned an unusable page');
    } catch (relayError) {
      throw new Error(
        `LNORI.com: direct fetch failed (${direct}) and browser-render relay ` +
          `also failed (${this.describe(relayError)}) for ${url}`,
      );
    }
  }

  // Library cache: in-memory memo over a PERSISTENT MMKV copy, so app
  // restarts (constant on e-ink devices) stop re-downloading the full
  // 1.8 MB / 884-card library page. When the stored copy is expired we serve
  // it anyway and refresh quietly in the background — Browse stays instant
  // and the site sees one refresh request per week, not one 1.8 MB fetch
  // per app start.
  private async getLibraryNovels(): Promise<LibraryEntry[]> {
    return this.loadLibrary(false);
  }

  private async loadLibrary(force = false): Promise<LibraryEntry[]> {
    if (!force && libraryCache) return libraryCache.items;
    const LIBRARY_KEY = 'library';
    if (!force) {
      const cached = this.cacheGet<LibraryEntry[]>(
        LIBRARY_KEY,
        LnoriComPlugin.LIBRARY_TTL_MS,
      );
      if (cached) {
        libraryCache = { items: cached.data, at: Date.now() };
        if (cached.stale) {
          void this.loadLibrary(true).catch(() => {});
        }
        return cached.data;
      }
    }
    const url = this.site + 'library';
    const body = await this.fetchPage(url);
    const $ = parseHTML(body);

    const parsedList: {
      novel: Plugin.NovelItem;
      author: string;
      tags: string[];
    }[] = [];

    $('article.card').each((i, el) => {
      const name = $(el).attr('data-t') || '';
      const author = $(el).attr('data-a') || '';
      const tagsAttr = $(el).attr('data-tags') || '';
      const tags = tagsAttr.split(',').map(t => t.trim().toLowerCase());

      const coverImg = $(el).find('.card-cover img').first();
      let cover = coverImg.attr('src') || '';
      if (cover && cover.startsWith('/')) {
        cover = this.site + cover.substring(1);
      }

      const link = $(el).find('a.stretched-link').first();
      let path = link.attr('href') || '';
      if (path.startsWith('/')) {
        path = path.substring(1);
      }

      if (path && name) {
        parsedList.push({
          novel: { name, path, cover: cover || defaultCover },
          author,
          tags,
        });
      }
    });

    libraryCache = { items: parsedList, at: Date.now() };
    this.cacheSet(LIBRARY_KEY, parsedList);
    return parsedList;
  }

  async popularNovels(
    pageNo: number,
    { filters }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const parsedList = await this.getLibraryNovels();

    let filteredList = parsedList;
    const selectedGenre = filters?.genre?.value;
    if (selectedGenre) {
      filteredList = filteredList.filter(item =>
        item.tags.includes(selectedGenre.toLowerCase()),
      );
    }

    const selectedSort = filters?.sort?.value;
    if (selectedSort === 'title-az') {
      filteredList.sort((a, b) => a.novel.name.localeCompare(b.novel.name));
    } else if (selectedSort === 'title-za') {
      filteredList.sort((a, b) => b.novel.name.localeCompare(a.novel.name));
    }

    // Cap the browsable total so the app's infinite scroll terminates instead
    // of paging through all ~884 titles (which felt like an endless spinner).
    const MAX = 360;
    if (filteredList.length > MAX) filteredList = filteredList.slice(0, MAX);

    const pageSize = 36;
    const offset = (pageNo - 1) * pageSize;
    return filteredList.slice(offset, offset + pageSize).map(item => item.novel);
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = this.site + novelPath;
    // Series page: persistent cache (12h) with stale-serve + quiet background
    // refresh, so reopening a book during a tarpit window still works.
    const seriesKey = 'series' + novelPath;
    let body: string;
    const cachedSeries = this.cacheGet<string>(seriesKey, LnoriComPlugin.SERIES_TTL_MS);
    if (cachedSeries) {
      body = cachedSeries.data;
      if (cachedSeries.stale) {
        void this.fetchPage(url)
          .then(fresh => this.cacheSet(seriesKey, fresh))
          .catch(() => {});
      }
    } else {
      body = await this.fetchPage(url);
      this.cacheSet(seriesKey, body);
    }
    const $ = parseHTML(body);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: $('.hero-card h1.s-title').text().trim() || 'Untitled',
    };

    const coverUrl = $('.hero-card .cover-wrap img').attr('src');
    novel.cover = coverUrl
      ? coverUrl.startsWith('/')
        ? this.site + coverUrl.substring(1)
        : coverUrl
      : defaultCover;

    // Tags render as <a class="tag"> inside nav.tags-box (the site no longer
    // serves the old data-tags JSON). Dedupe: desktop and mobile navs carry
    // the same tags and the old selector matched nodes more than once, which
    // tripled every genre in the listing.
    const genres: string[] = [];
    const seenGenres = new Set<string>();
    $('nav.tags-box a.tag').each((i, el) => {
      const key = $(el).text().trim().toLowerCase();
      if (key && !seenGenres.has(key)) {
        seenGenres.add(key);
        genres.push(key);
      }
    });
    novel.genres = genres.join(', ');

    const summaryParagraphs: string[] = [];
    $('section.desc-box p.description').each((i, el) => {
      const text = $(el).text().trim();
      if (text) summaryParagraphs.push(text);
    });
    novel.summary = summaryParagraphs.join('\n\n');
    novel.author = $('.hero-card p.author').text().trim();

    const volumeMap: Record<string, string> = {};
    $('a[href^="/book/"]').each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      if (href) {
        if (!volumeMap[href] || (text && text.length > volumeMap[href].length)) {
          volumeMap[href] = text;
        }
      }
    });

    const getVolumeName = (href: string, text: string) => {
      let cleanText = text.replace(/Start Reading/gi, '').trim();
      if (!cleanText) {
        const parts = href.split('/');
        const slug = parts[parts.length - 1] || parts[parts.length - 2] || '';
        cleanText = slug
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      }
      return cleanText;
    };

    const volumeUrls = Object.keys(volumeMap);
    // A linkless series page means the fetch got something other than the real
    // catalog (Cloudflare interstitial, soft-404). Returning [] here used to
    // surface as a silent "0 chapters"; fail loudly instead.
    if (volumeUrls.length === 0) {
      throw new Error(
        'LNORI.com returned no volumes for this series — the site likely served ' +
          'a bot-check page. Open it once in webview/browser, then refresh.',
      );
    }
    // Per-volume page -> chapter list (pure parse, no I/O).
    const parseVolume = ($vol: CheerioAPI, volUrl: string): Plugin.ChapterItem[] => {
      const volChapters: Plugin.ChapterItem[] = [];
      const tocLinks = $vol('nav.toc-view a[href^="#"], nav#toc-list a[href^="#"]');

      if (tocLinks.length > 0) {
        tocLinks.each((i, el) => {
          const href = $vol(el).attr('href');
          if (!href) return;
          const id = href.substring(1);
          const tocTitle = $vol(el).text().trim().replace(/\s+/g, ' ');
          const section = $vol(`section#${id}`);
          const h2Title = section.find('h2.chapter-title, h2, h3').first().text().trim();
          const chapterName = tocTitle || h2Title || `Page ${id.replace(/\D/g, '')}`;
          const volTitle = getVolumeName(volUrl, volumeMap[volUrl]);
          let path = volUrl;
          if (path.startsWith('/')) path = path.substring(1);
          volChapters.push({ name: `${volTitle} - ${chapterName}`, path: path + '#' + id });
        });
      } else {
        $vol('section.chapter').each((i, el) => {
          const id = $vol(el).attr('id');
          if (!id) return;
          const h2Title = $vol(el).find('h2.chapter-title, h2, h3').first().text().trim();
          if (!h2Title) return;
          const volTitle = getVolumeName(volUrl, volumeMap[volUrl]);
          let path = volUrl;
          if (path.startsWith('/')) path = path.substring(1);
          volChapters.push({ name: `${volTitle} - ${h2Title}`, path: path + '#' + id });
        });
      }
      return volChapters;
    };

    // Fetch volume pages with a small bounded pool (order preserved via
    // indexed results). Purely-sequential fetching made a 17-volume series
    // wait on 17 serialized ~350 KB pages; 4-way keeps RAM pressure low for
    // e-ink devices while cutting wall time to roughly a quarter.
    // Volume pages: persistent per-volume cache (24h). Only volumes missing
    // from cache hit the network; a volume whose fetch fails is served from
    // its stale copy instead of vanishing (the Konosuba missing-volume bug
    // must never come back through a transient timeout).
    const results: (Plugin.ChapterItem[] | undefined)[] = new Array(volumeUrls.length);
    let cursor = 0;
    const loadVolume = async (idx: number): Promise<void> => {
      const volUrl = volumeUrls[idx];
      const volKey = 'vol' + volUrl;
      const fullVolUrl = this.site.replace(/\/$/, '') + volUrl;
      const cachedVol = this.cacheGet<Plugin.ChapterItem[]>(
        volKey,
        LnoriComPlugin.VOLUME_TTL_MS,
      );
      if (cachedVol && !cachedVol.stale) {
        results[idx] = cachedVol.data;
        return;
      }
      try {
        const $vol = parseHTML(await this.fetchPage(fullVolUrl));
        const parsed = parseVolume($vol, volUrl);
        results[idx] = parsed;
        this.cacheSet(volKey, parsed);
      } catch (e) {
        if (cachedVol) {
          results[idx] = cachedVol.data; // stale list beats a missing volume
          return;
        }
        throw new Error(
          `LNORI.com: could not load a volume of this series (${volUrl}) and no ` +
            `cached copy exists yet. Try again later, or open the series once in a browser.`,
        );
      }
    };
    const workers = Array.from(
      { length: Math.min(4, volumeUrls.length) },
      async () => {
        while (cursor < volumeUrls.length) {
          const idx = cursor++;
          await loadVolume(idx);
        }
      },
    );
    const settled = await Promise.allSettled(workers);
    for (const s of settled) {
      if (s.status === 'rejected') {
        throw s.reason instanceof Error ? s.reason : new Error(String(s.reason));
      }
    }
    let chapters: Plugin.ChapterItem[] = results.map(r => r ?? []).flat();

    // Toggle (default on): fold front/back-matter pages into one entry PER
    // VOLUME. Real series data (e.g. lnori Konosuba, 17 volumes) shows every
    // volume carries its own Cover / Insert(s) / Title Page cluster — often
    // with "Insert" pages BETWEEN Cover and Title Page — so:
    //   1. match by suffix ("... - Cover", "... - Insert", "... - Title Page"),
    //   2. group consecutive matter entries that ALSO share the same volume
    //      path (a group never spans two volumes),
    //   3. label the merged row from its actual contents with the volume
    //      prefix kept ("Vol 2 - Cover & Insert & Title Page") so the N groups
    //      in a multi-volume series stay distinguishable.
    if (storage.get('mergeCoverTitle') ?? true) {
      // Plural-tolerant: real TOCs use "Color Illustrations", "Inserts", etc.
      const MATTER_RE =
        /(character\s+galler(?:y|ies)|covers?|inserts?|illustrations?|color\s+illustrations?|title\s*pages?|prolog(?:ue|s)?|prolog|colophons?|copyrights?|front\s*matters?|back\s*matters?|table\s+of\s+contents?)\s*$/i;
      const matterLabel = (name: string): string | null => {
        const m = name.trim().match(MATTER_RE);
        if (!m) return null;
        return m[1].replace(/\s+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      };
      const merged: Plugin.ChapterItem[] = [];
      let i = 0;
      while (i < chapters.length) {
        const cur = chapters[i];
        const curLabel = matterLabel(cur.name);
        const curBase = cur.path.split('#')[0];
        if (curLabel) {
          const group = [cur];
          const labels = new Set<string>([curLabel]);
          let base = curBase;
          while (
            i + 1 < chapters.length &&
            chapters[i + 1].path.split('#')[0] === base &&
            matterLabel(chapters[i + 1].name)
          ) {
            i++;
            group.push(chapters[i]);
            labels.add(matterLabel(chapters[i].name)!);
          }
          const anchors = group.map(c => c.path.split('#')[1]).join(',');
          // Volume prefix = everything before the trailing matter suffix of
          // the first entry ("Konosuba ... Vol 2 - Cover" -> "Konosuba ... Vol 2 - ").
          const prefix = cur.name.slice(0, cur.name.trim().length - curLabel.length);
          if (group.length === 1) {
            merged.push(cur); // lone matter page keeps its own name
          } else {
            merged.push({
              ...cur,
              name: `${prefix}${Array.from(labels).join(' & ')}`,
              path: `${base}#${anchors}`,
            });
          }
        } else {
          merged.push(cur);
        }
        i++;
      }
      chapters = merged;
    }

    novel.chapters = chapters.map((chap, idx) => ({
      ...chap,
      chapterNumber: idx + 1,
    }));

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const [pathWithoutAnchor, anchorRaw] = chapterPath.split('#');
    // A merged "Cover & Title Page" entry carries two anchors joined by comma
    // ("page01,page02"); render each section and concatenate.
    const anchors = (anchorRaw || '').split(',').filter(Boolean);
    const url = this.site.replace(/\/$/, '') + '/' + pathWithoutAnchor;
    // Chapter pages never change once published: cache for 30 days so
    // re-reading (and tarpit windows) never touches the network. Cap stored
    // size to keep MMKV lean.
    const chapKey = 'chap' + chapterPath;
    let body: string;
    const cachedChap = this.cacheGet<string>(chapKey, LnoriComPlugin.CHAPTER_TTL_MS);
    if (cachedChap) {
      body = cachedChap.data;
    } else {
      body = await this.fetchPage(url);
      if (body.length < 800000) this.cacheSet(chapKey, body);
    }
    const $ = parseHTML(body);

    const tocAnchors: string[] = [];
    $('nav.toc-view a[href^="#"], nav#toc-list a[href^="#"]').each((i, el) => {
      const href = $(el).attr('href');
      if (href) tocAnchors.push(href.substring(1));
    });

    // Render one TOC anchor: the section itself PLUS every following
    // sibling <section class="chapter"> up to (not including) the next
    // TOC-listed anchor. Chapters span MULTIPLE unnamed page-sections
    // (Konosuba Vol 1 Prologue = page10+page11+page12) — rendering only the
    // named section silently truncated the tail of every chapter.
    const renderAnchorRange = (anchor: string): string => {
      const currentIndex = tocAnchors.indexOf(anchor);
      const nextAnchor =
        currentIndex !== -1 && currentIndex + 1 < tocAnchors.length
          ? tocAnchors[currentIndex + 1]
          : null;
      if (tocAnchors.length === 0 || currentIndex === -1) {
        // Anchor not in TOC (or no TOC): fall back to just that section.
        const sec = anchor ? $(`section#${anchor}`) : $('section.chapter').first();
        if (!sec.length) return '';
        const mc = sec.find('.main').length ? sec.find('.main').clone() : sec.clone();
        mc.find('h2, h3, .chapter-title').remove();
        mc.find('img').each((i, el) => {
          const src = $(el).attr('src');
          if (src && src.startsWith('/')) $(el).attr('src', this.site.replace(/\/$/, '') + src);
        });
        mc.find('source').each((i, el) => {
          const srcset = $(el).attr('srcset');
          if (srcset && srcset.startsWith('/')) $(el).attr('srcset', this.site.replace(/\/$/, '') + srcset);
        });
        return mc.html() || '';
      }
      const pagesContent: string[] = [];
      let stepSection = $(`section#${anchor}`);
      while (stepSection.length) {
        const mc = stepSection.find('.main').length
          ? stepSection.find('.main').clone()
          : stepSection.clone();
        mc.find('h2, h3, .chapter-title').remove();
        mc.find('img').each((i, el) => {
          const src = $(el).attr('src');
          if (src && src.startsWith('/')) $(el).attr('src', this.site.replace(/\/$/, '') + src);
        });
        mc.find('source').each((i, el) => {
          const srcset = $(el).attr('srcset');
          if (srcset && srcset.startsWith('/')) $(el).attr('srcset', this.site.replace(/\/$/, '') + srcset);
        });
        const html = mc.html();
        if (html) pagesContent.push(html);

        let nextSibling = stepSection.next();
        while (nextSibling.length && !nextSibling.is('section.chapter')) {
          nextSibling = nextSibling.next();
        }
        stepSection = nextSibling;
        if (nextAnchor && stepSection.attr('id') === nextAnchor) break;
      }
      return pagesContent.join('\n');
    };

    // Multi-anchor (merged matter rows): render each anchor's full range.
    if (anchors.length > 1) {
      return anchors.map(a => renderAnchorRange(a)).filter(Boolean).join('\n');
    }

    const anchor = anchors[0] || '';
    const chapterSelector = anchor ? `section#${anchor}` : 'section.chapter';
    const section = $(chapterSelector);
    if (!section.length) {
      throw new Error(`Chapter section not found: ${chapterPath}`);
    }

    if (anchor || tocAnchors.length > 0) {
      return renderAnchorRange(anchor);
    }

    const mainContent = section.find('.main').length
      ? section.find('.main').clone()
      : section.clone();
    mainContent.find('h2, h3, .chapter-title').remove();
    mainContent.find('img').each((i, el) => {
      const src = $(el).attr('src');
      if (src && src.startsWith('/')) {
        $(el).attr('src', this.site.replace(/\/$/, '') + src);
      }
    });
    mainContent.find('source').each((i, el) => {
      const srcset = $(el).attr('srcset');
      if (srcset && srcset.startsWith('/')) {
        $(el).attr('srcset', this.site.replace(/\/$/, '') + srcset);
      }
    });
    return mainContent.html() || '';
  }

  async searchNovels(searchTerm: string, pageNo: number): Promise<Plugin.NovelItem[]> {
    const parsedList = await this.getLibraryNovels();
    const term = searchTerm.toLowerCase();
    const filteredList = parsedList.filter(item =>
      item.novel.name.toLowerCase().includes(term) ||
      item.author.toLowerCase().includes(term) ||
      item.tags.some(t => t.includes(term)),
    );
    const pageSize = 36;
    const offset = (pageNo - 1) * pageSize;
    return filteredList.slice(offset, offset + pageSize).map(item => item.novel);
  }

  filters = {
    sort: {
      label: 'Sort By',
      value: 'popular',
      options: [
        { label: 'Popular (Default)', value: 'popular' },
        { label: 'Title A-Z', value: 'title-az' },
        { label: 'Title Z-A', value: 'title-za' },
      ],
      type: FilterTypes.Picker,
    },
    genre: {
      label: 'Genre',
      value: '',
      options: [
        { label: 'All', value: '' },
        { label: 'Academy', value: 'academy' },
        { label: 'Action', value: 'action' },
        { label: 'Adventure', value: 'adventure' },
        { label: 'Comedy', value: 'comedy' },
        { label: 'Drama', value: 'drama' },
        { label: 'Fantasy', value: 'fantasy' },
        { label: 'Harem', value: 'harem' },
        { label: 'Historical', value: 'historical' },
        { label: 'Isekai', value: 'isekai' },
        { label: 'Magic', value: 'magic' },
        { label: 'Mystery', value: 'mystery' },
        { label: 'Psychological', value: 'psychological' },
        { label: 'Reincarnation', value: 'reincarnation' },
        { label: 'Romance', value: 'romance' },
        { label: 'Sci-Fi', value: 'sci-fi' },
        { label: 'Slice of Life', value: 'slice-of-life' },
        { label: 'Tragedy', value: 'tragedy' },
        { label: 'Female Protagonist', value: 'female protagonist' },
        { label: 'Male Protagonist', value: 'male protagonist' },
      ],
      type: FilterTypes.Picker,
    },
  } satisfies Filters;
}

export default new LnoriComPlugin();
