import { fetchApi } from '@libs/fetch';
import type { Plugin } from '@/types/plugin';
import { FilterTypes, type Filters } from '@libs/filterInputs';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { storage } from '@libs/storage';

const GENRE_OPTIONS = [
  { label: 'Action', value: 'action' },
  { label: 'Adult', value: 'adult' },
  { label: 'Adventure', value: 'adventure' },
  { label: 'Comedy', value: 'comedy' },
  { label: 'Drama', value: 'drama' },
  { label: 'Eastern', value: 'eastern' },
  { label: 'Ecchi', value: 'ecchi' },
  { label: 'Fan-Fiction', value: 'fan-fiction' },
  { label: 'Fantasy', value: 'fantasy' },
  { label: 'Game', value: 'game' },
  { label: 'Gender Bender', value: 'gender bender' },
  { label: 'Harem', value: 'harem' },
  { label: 'Historical', value: 'historical' },
  { label: 'Horror', value: 'horror' },
  { label: 'Isekai', value: 'isekai' },
  { label: 'Josei', value: 'josei' },
  { label: 'LGBT+', value: 'lgbt+' },
  { label: 'LitRPG', value: 'litrpg' },
  { label: 'Magic', value: 'magic' },
  { label: 'Magical Realism', value: 'magical realism' },
  { label: 'Manhua', value: 'manhua' },
  { label: 'Martial Arts', value: 'martial arts' },
  { label: 'Mature', value: 'mature' },
  { label: 'Mecha', value: 'mecha' },
  { label: 'Military', value: 'military' },
  { label: 'Modern Life', value: 'modern life' },
  { label: 'Mystery', value: 'mystery' },
  { label: 'Other', value: 'other' },
  { label: 'Psychological', value: 'psychological' },
  { label: 'Reincarnation', value: 'reincarnation' },
  { label: 'Romance', value: 'romance' },
  { label: 'School Life', value: 'school life' },
  { label: 'Sci-Fi', value: 'sci-fi' },
  { label: 'Seinen', value: 'seinen' },
  { label: 'Shoujo', value: 'shoujo' },
  { label: 'Shoujo Ai', value: 'shoujo ai' },
  { label: 'Shounen', value: 'shounen' },
  { label: 'Shounen Ai', value: 'shounen ai' },
  { label: 'Slice Of Life', value: 'slice of life' },
  { label: 'Smut', value: 'smut' },
  { label: 'Sports', value: 'sports' },
  { label: 'Supernatural', value: 'supernatural' },
  { label: 'System', value: 'system' },
  { label: 'Thriller', value: 'thriller' },
  { label: 'Tragedy', value: 'tragedy' },
  { label: 'Urban', value: 'urban' },
  { label: 'Urban Life', value: 'urban life' },
  { label: 'Video Games', value: 'video games' },
  { label: 'War', value: 'war' },
  { label: 'Wuxia', value: 'wuxia' },
  { label: 'Xianxia', value: 'xianxia' },
  { label: 'Xuanhuan', value: 'xuanhuan' },
  { label: 'Yaoi', value: 'yaoi' },
  { label: 'Yuri', value: 'yuri' },
] as const;

type NovelArchiveNovel = {
  id?: string;
  title?: string;
  author?: string;
  genres?: string;
  description?: string;
  cover_url?: string;
  novel_image?: string;
  image_url?: string;
  total_chapters?: string | number;
  release_status?: string;
  ongoing?: string;
  chapter_names?: string[];
};

type NovelsResponse = {
  novels?: NovelArchiveNovel[];
};

type NovelResponse = {
  novel?: NovelArchiveNovel;
};

type ChapterResponse = {
  chapter?: {
    number?: number;
    name?: string;
    content?: string;
  };
};

// Discovered volume during merge: id + title (for volume-number sorting).
type DiscoveredVolume = { id: string; title: string };

// Matches "Chapter 1" / "chapter  3" at the start of a chapter name.
// Hoisted so it isn't recompiled for every chapter in every volume.
const CHAPTER_NAME_RE = /^chapter\s*(\d+)/i;

// Module-level (not instance) caches: LNReader may re-instantiate the plugin
// object between calls, which silently wipes instance fields. These survive as
// long as the module itself stays loaded in the app session.
// searchSeen: dedupe set for search pagination; seriesVolumes: discovered
// seriesKey -> volume ids (the API has no series endpoint, so discovery is a
// pair of searches per series — caching skips them on every open/refresh).
const searchSeen = new Set<string>();
const seriesVolumes = new Map<string, string[]>();

class NovelArchivePlugin implements Plugin.PluginBase {
  id = 'novelarchive';
  version = '1.1.32';
  icon = 'src/en/novelarchive/icon.png';
  site = 'https://novelarchive.cc';
  // Required by the app's PluginItem: the UPDATE path copies name/site/lang
  // from this evaluated module back into the stored plugin row.
  lang = 'English';
  pluginSettings = {
    mergeSeries: {
      label: 'Merge all volumes into one series',
      type: 'Switch',
      value: false,
    },
    skipUnavailable: {
      label: 'Skip empty chapters (drop & renumber)',
      type: 'Switch',
      value: true,
    },
    mergeVolumesToMega: {
      label: 'Merge chapters into volume mega-chapters',
      type: 'Switch',
      value: false,
    },
    fuzzySearch: {
      label: 'Fuzzy search',
      type: 'Switch',
      value: true,
    },
  };
  filters = {
    sort: {
      type: FilterTypes.Picker,
      value: 'rating',
      label: 'Sort by',
      options: [
        { label: 'Recent', value: 'recent' },
        { label: 'Popular', value: 'popular' },
        { label: 'Top Rated', value: 'rating' },
        { label: 'Chapters', value: 'chapters' },
      ],
    },
    status: {
      type: FilterTypes.Picker,
      value: 'all',
      label: 'Status',
      options: [
        { label: 'All', value: 'all' },
        { label: 'Ongoing', value: 'ongoing' },
        { label: 'Completed', value: 'completed' },
        { label: 'Hiatus', value: 'hiatus' },
      ],
    },
    genre: {
      type: FilterTypes.ExcludableCheckboxGroup,
      value: {
        include: [],
        exclude: [],
      },
      label: 'Genres',
      options: GENRE_OPTIONS,
    },
    genreMatch: {
      type: FilterTypes.Picker,
      value: 'all',
      label: 'Genre match',
      options: [
        { label: 'All selected', value: 'all' },
        { label: 'Any selected', value: 'any' },
      ],
    },
  } satisfies Filters;
  imageRequestInit: Plugin.ImageRequestInit = {
    headers: {
      Referer: this.site,
    },
  };
  // Tracks series-keys (or paths when merge is off) already returned across
  // search pages. The NovelArchive search API never returns an empty page:
  // page 2 returns a tail of volumes and every page >=2 repeats that same
  // tail, so the app's "stop when empty" rule never trips and it fetches
  // forever, appending duplicate series as empty/ghost rows. We terminate
  // pagination ourselves by returning [] once a page contributes nothing new.
  // Cache of seriesKey -> volume ids, discovered during merge. The NovelArchive
  // API has no series endpoint, so we rediscover volumes via search; caching
  // avoids re-hitting the API on every parseNovel (e.g. library refresh).
  // Per-volume detail fetch cap (ms) during merge, so a single slow/hanging
  // volume can't stall the whole novel ("loading forever").
  private static readonly VOLUME_TIMEOUT_MS = 8000;
  // Concurrency for the eager "skip unavailable" scan: how many chapter
  // availability probes run in parallel. NovelArchive (Cloudflare) showed no
  // rate limiting at 150 parallel requests; 64 keeps the burst polite.
  private static readonly SKIP_CONCURRENCY = 64;
  // Per-chapter availability probe timeout (ms). A probe that exceeds this is
  // treated as "keep" rather than hanging the whole parseNovel (which is what
  // made "Merge volumes" spin forever — 318 chapter probes with no upper
  // bound on a slow API). Bounded so the merge always finishes.
  private static readonly PROBE_TIMEOUT_MS = 6000;
  // Source title of the novel currently being parsed (used by the mega builder
  // to infer a single-volume novel's volume number when names lack a prefix).
  private lastSourceTitle = '';

  async popularNovels(
    pageNo: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const endpoint = this.getPopularEndpoint(pageNo, showLatestNovels, filters);
    const response = await this.apiGet<NovelsResponse>(endpoint);

    return this.toNovelItems(response.novels);
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const id = this.extractNovelId(novelPath);
    const response = await this.apiGet<NovelResponse>(
      `/api/novels/${encodeURIComponent(id)}`,
    );
    const source = response.novel;
    this.lastSourceTitle = source.title || '';

    if (!source) {
      throw new Error(`NovelArchive novel not found: ${id}`);
    }

    const author = this.cleanText(source.author);
    const novel: Plugin.SourceNovel = {
      path: id,
      name: this.cleanText(source.title) || 'Untitled',
      author: author || undefined,
      artist: author || undefined,
      cover: this.absoluteUrl(
        source.cover_url || source.novel_image || source.image_url,
      ),
      genres: this.normalizeGenres(source.genres),
      status: this.toNovelStatus(source.release_status || source.ongoing),
      summary: this.cleanText(source.description) || undefined,
      chapters: this.toChapters(id, source),
    };
    // Merge volumes: NovelArchive has no series concept -- each "Vol N" is an
    // independent novel with its own id and chapter list, and its chapters are
    // numbered across the whole series (Vol 3 starts at Chapter 8), not 1..N
    // per volume. So a naive collapse just hides the other volumes. When merge
    // is on, rediscover every sibling volume via search and concatenate all
    // STEP 1: Drop empty (404) chapters from this base volume and renumber.
    // Always on — a 404 chapter is unusable, so it never belongs in the list.
    novel.chapters = await this.filterUnavailableChapters(novel.chapters);

    // STEP 2: Merge sibling volumes into one series (if enabled).
    if (storage.get('mergeSeries')) {
      try {
        const key = this.toSeriesKey(source.title);
        let ids = seriesVolumes.get(key);
        let volCount = 0;
        if (!ids) {
          const fuzzyEnabled = storage.get('fuzzySearch') ?? true;
          const queries = [
            this.mergeSearchToken(source.title),
            this.baseTitle(source.title),
          ].filter(Boolean);
          const results = await Promise.all(
            queries.map(q =>
              this.apiGet<NovelsResponse>(
                `/api/novels?search=${encodeURIComponent(q)}&per_page=50&fuzzy=${
                  fuzzyEnabled ? '1' : '0'
                }`,
              )
                .then(r =>
                  (r.novels || []).map<DiscoveredVolume>(n => ({
                    id: String(n.id),
                    title: n.title,
                  })),
                )
                .catch(() => [] as DiscoveredVolume[]),
            ),
          );
          const seen = new Set<string>();
          const collected: DiscoveredVolume[] = [];
          for (const list of results) {
            for (const n of list) {
              if (this.toSeriesKey(n.title) !== key) continue;
              if (/vol\.?\s*\d+\s*-\s*\d+/i.test(n.title)) continue;
              if (n.id && !seen.has(n.id)) {
                seen.add(n.id);
                collected.push(n);
              }
            }
          }
          collected.sort(
            (a, b) => this.volumeNumber(a.title) - this.volumeNumber(b.title),
          );
          ids = collected.map(n => n.id).slice(0, 30);
          volCount = ids.length;
          seriesVolumes.set(key, ids);
        } else {
          volCount = ids.length;
        }

        const settled = await Promise.allSettled(
          ids.map(vid => this.fetchVolumeChapters(vid)),
        );
        // A volume that failed (timeout/5xx) contributes ZERO chapters, which
        // used to silently produce a truncated series (user-visible as "only
        // Volume 1 exists"). Surface failures instead of swallowing them.
        const failed = settled.filter(s => s.status === 'rejected').length;
        const merged: Plugin.ChapterItem[] = [];
        let seq = 0;
        for (const s of settled) {
          if (s.status !== 'fulfilled') continue;
          for (const ch of s.value) {
            seq += 1;
            // Rename BEFORE spreading: the pushed copy must carry the global
            // sequence number, not the per-volume one it was fetched with.
            const volMatch = ch.name.match(/Volume\s+(\d+)/i);
            const vol = volMatch ? volMatch[1] : '';
            const name = vol ? `Volume ${vol} Chapter ${seq}` : ch.name;
            merged.push({ ...ch, chapterNumber: seq, name });
          }
        }
        if (merged.length) {
          novel.chapters = merged;
          let banner = `[${volCount} volumes merged — ${merged.length} chapters total]`;
          if (failed > 0) {
            banner += ` — WARNING: ${failed} volume(s) failed to load; refresh to retry`;
          }
          novel.summary = `${banner}\n` + (novel.summary ?? '');
        } else if (failed > 0) {
          // Every volume failed — do NOT leave a stale/partial list behind.
          throw new Error(
            `All ${volCount} volumes failed to load — check connection, then refresh the novel.`,
          );
        }
      } catch {
        // Discovery/fetch blew up — fall back to the single-volume list
        // (already filtered) rather than leaving a broken state.
      }
     }

    // STEP 3: Merge each volume's chapters into one mega-chapter (if enabled).
    if (storage.get('mergeVolumesToMega')) {
      novel.chapters = await this.mergeVolumesToMegaChapters(novel.chapters);
    }

    return novel;
  }

  private async fetchVolumeChapters(
    volumeId: string,
  ): Promise<Plugin.ChapterItem[]> {
    // Cap each volume fetch so a slow/hanging volume can't stall the whole
    // merged novel (which would show as "loading forever" on-device). We race
    // the request against a timer and cancel the timer once it settles, so no
    // dangling timeout is left running. On timeout we treat it as an empty
    // volume (skipped), never as a hang.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = this.apiGet<NovelResponse>(
      `/api/novels/${encodeURIComponent(volumeId)}`,
    );
    const timeout = new Promise<NovelResponse>(resolve => {
      timer = setTimeout(() => resolve({}), NovelArchivePlugin.VOLUME_TIMEOUT_MS);
    });
    try {
      const response = await Promise.race([request, timeout]);
      const novel = response?.novel;
      if (!novel) return [];
      const chapters = this.toChapters(volumeId, novel);
      // Drop empty (404) chapters for THIS volume now, so the merged list the
      // caller concatenates is already clean — we must not re-scan all ~318
      // merged chapters again (that second pass is what made "Merge volumes"
      // spin forever). The probe is time-bounded so a slow API can't stall us.
      const probed = await this.filterUnavailableChapters(chapters);
      // Prefix each chapter's display name with its volume number so a merged
      // multi-volume list reads as one continuous series instead of seventeen
      // identical "Chapter 1" rows. The path (volumeId/origNumber) is left
      // untouched so parseChapter still resolves content from the volume that
      // actually owns the chapter.
      const vol = this.volumeNumber(novel.title);
      if (vol > 0) {
        for (const ch of probed) {
          ch.name = `Volume ${vol} Chapter ${ch.chapterNumber}`;
        }
      }
      return probed;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private async probeChapterAvailable(
    novelId: string,
    chapterNumber: number,
  ): Promise<boolean> {
    try {
      // Use fetchApi directly (not apiGet) so we can inspect the HTTP status.
      // A confirmed non-OK (e.g. 404) means the chapter is genuinely absent ->
      // drop it. Any *network* error (timeout, Cloudflare blip, offline) is
      // UNVERIFIABLE, so we return "keep" — a flaky connection must never wipe
      // the whole list. (Previously a thrown error returned false, which made
      // a single bad probe drop the chapter; on a rate-limited/Cloudflare
      // device enough probes failed that the merged+mega list collapsed to 0.)
      const resp = await fetchApi(
        `${this.site}/api/novels/${encodeURIComponent(
          novelId,
        )}/chapters/${encodeURIComponent(String(chapterNumber))}`,
        { headers: { Accept: 'application/json' } },
      );
      if (!resp.ok) return false;
      const data = (await resp.json()) as ChapterResponse;
      return Boolean(data.chapter?.content);
    } catch {
      // Network error / unverifiable -> keep the chapter.
      return true;
    }
  }

  // Eager mode: probe every chapter in parallel (bounded by
  // SKIP_CONCURRENCY), drop the ones that 404 / have no content, and renumber
  // the survivors 1..N. Runs once; the app caches the resulting list. A probe
  // failure means "keep" -- we don't drop a chapter we couldn't verify.
  private async filterUnavailableChapters(
    chapters: Plugin.ChapterItem[],
  ): Promise<Plugin.ChapterItem[]> {
    if (!chapters.length) return chapters;
    const tasks = chapters.map(async ch => {
      const [novelId, num] = ch.path.split('/');
      const available = await this.probeChapterAvailable(novelId, Number(num));
      // Unverifiable (network error) -> keep, don't drop.
      return available ? ch : null;
    });
    const settled = await this.runWithConcurrency(
      tasks,
      NovelArchivePlugin.SKIP_CONCURRENCY,
    );
    const kept = settled.filter(
      (c): c is Plugin.ChapterItem => c !== null,
    );
    return kept.map((ch, n) => {
      const newNum = n + 1;
      // Update display name to match new sequential number
      const volMatch = ch.name.match(/Volume\s+(\d+)/i);
      const vol = volMatch ? volMatch[1] : '';
      return {
        ...ch,
        chapterNumber: newNum,
        name: vol ? `Volume ${vol} Chapter ${newNum}` : ch.name,
      };
    });
  }

  // Merge each volume's chapters into one mega chapter per volume.
  // Input chapters must have names like "Volume N Chapter X" and paths "volId/origNum".
  // Output: 1 chapter per volume with path "volId/M", name "Volume N (Full)",
  // containing concatenated HTML of all that volume's chapters.
  private async mergeVolumesToMegaChapters(
    chapters: Plugin.ChapterItem[],
  ): Promise<Plugin.ChapterItem[]> {
    if (!chapters.length) return chapters;

    // Input is ALWAYS already empty-dropped: merge-series filters per-volume
    // inside fetchVolumeChapters, and the single-volume path filters right
    // after toChapters. Re-probing all ~320 chapters here doubled the probe
    // count (+40 s on Konosuba) for zero effect — skipped chapters like
    // Konosuba's empty Ch.2 are already gone, so headers stay sequential.

    // Group by volume number from display name; fall back to the source
    // novel's own volume number when chapters aren't prefixed (single-volume
    // path with merge off).
    const byVolume = new Map<string, Plugin.ChapterItem[]>();
    for (const ch of chapters) {
      const match = ch.name.match(/Volume\s+(\d+)/i);
      let vol = match ? match[1] : '0';
      if (vol === '0') {
        const v = this.volumeNumber(this.lastSourceTitle);
        vol = v > 0 ? String(v) : '1';
      }
      if (!byVolume.has(vol)) byVolume.set(vol, []);
      byVolume.get(vol)!.push(ch);
    }

    // Sort volumes numerically
    const sortedVols = Array.from(byVolume.keys()).sort(
      (a, b) => Number(a) - Number(b),
    );

    // Create one mega chapter per (non-empty) volume, each carrying the
    // already-cleaned, renumbered chapter list so its content build skips
    // empties and emits sequential headers.
    const mega: Plugin.ChapterItem[] = [];
    for (const vol of sortedVols) {
      const volChapters = byVolume.get(vol)!;
      const first = volChapters[0];
      const volumeId = first.path.split('/')[0];
      // Encode the volume number AND the cleaned chapter numbers into the
      // path itself — NOT an in-memory cache. LNReader may re-instantiate the
      // plugin between parseNovel and parseChapter, which would wipe an
      // instance cache and leave every mega chapter empty. With the data in
      // the path, parseChapter rebuilds content statelessly (and can label
      // each <h2> as "Volume N Chapter X").
      const nums = volChapters.map(c => c.path.split('/')[1]).join(',');
      mega.push({
        name: `Volume ${vol} (Full)`,
        path: `${volumeId}/M/V${vol}/${nums}`,
        chapterNumber: mega.length + 1,
      });
    }
    return mega;
  }
  // empty-dropped, renumbered chapter list. We do NOT re-fetch the raw volume
  // list here, because that would re-include the 404 chapters we already
  // dropped — exactly the "missing Chapter 2 heading" bug. Each entry's path
  // is "volumeId/origNum", so we fetch just its content; a 404 is skipped and
  // the sequential numbering (already in ch.name) is preserved as headers.
  private async fetchAndConcatVolumeChapters(
    volumeId: string,
    chapters: Plugin.ChapterItem[],
  ): Promise<string> {
    // Fetch a volume's chapters with bounded parallelism (order preserved via
    // the indexed results). Sequential fetching made opening a "(Full)" mega
    // chapter wait on ~19 round-trips; 8-way cuts that to ~3 waves.
    const tasks = chapters.map(ch => (async (): Promise<string | null> => {
      const [, num] = ch.path.split('/');
      try {
        const resp = await this.apiGet<ChapterResponse>(
          `/api/novels/${encodeURIComponent(volumeId)}/chapters/${encodeURIComponent(
            String(num),
          )}`,
        );
        const content = resp.chapter?.content;
        if (!content) return null;
        return `<h2>${ch.name}</h2>\n${this.toChapterHtml(content)}`;
      } catch {
        return null; // late 404 / blip — already excluded by the eager scan
      }
    })());
    const parts = await this.runWithConcurrency(tasks, 8);
    return parts.filter((p): p is string => p !== null).join('\n<hr/>\n');
  }
  // Run async tasks with a bounded concurrency limit, preserving input order.
  private async runWithConcurrency<T>(
    tasks: Promise<T>[],
    limit: number,
  ): Promise<T[]> {
    let resolve!: (v: T[]) => void;
    const promise = new Promise<T[]>(res => {
      resolve = res;
    });
    const results: T[] = new Array(tasks.length);
    let active = 0;
    let cursor = 0;
    const next = () => {
      while (active < limit && cursor < tasks.length) {
        const i = cursor++;
        active++;
        tasks[i]
          .then(v => {
            results[i] = v;
          })
          .catch(() => {
            results[i] = undefined as T;
          })
          .finally(() => {
            active--;
            if (cursor >= tasks.length && active === 0) resolve(results);
            else next();
          });
      }
    };
    next();
    return promise;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    // Mega chapter path format: "volumeId/M/num1,num2,..." (M = mega). The
    // cleaned chapter numbers are encoded in the path so content builds
    // statelessly (no instance cache that LNReader might wipe between
    // parseNovel and parseChapter).
    const m = chapterPath.match(/^(.+)\/M\/V(\d+)\/(.+)$/);
    if (m) {
      const volumeId = m[1];
      const vol = m[2];
      const nums = m[3].split(',').filter(Boolean);
      const chapters = nums.map(num => ({
        path: `${volumeId}/${num}`,
        name: `Volume ${vol} Chapter ${num}`,
      }));
      return this.fetchAndConcatVolumeChapters(volumeId, chapters);
    }
    const [pathWithoutAnchor, anchor] = chapterPath.split('#');
    const url = this.site.replace(/\/$/, '') + '/' + pathWithoutAnchor;
    const { novelId, chapterNumber } = this.parseChapterPath(chapterPath);
    const response = await this.apiGet<ChapterResponse>(
      `/api/novels/${encodeURIComponent(novelId)}/chapters/${encodeURIComponent(
        chapterNumber,
      )}`,
    );
    const content = response.chapter?.content;

    if (!content) {
      throw new Error(`NovelArchive chapter not found: ${chapterPath}`);
    }

    return this.toChapterHtml(content);
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const query = searchTerm.trim();
    // The NovelArchive search index ranks concatenated/lower-cased tokens
    // highest. A single punctuated token like "re:zero" returns garbage, but
    // "rezero" returns the correct series first. For space-free queries, strip
    // punctuation so "re:zero" -> "rezero". Multi-word queries keep spaces
    // (they already rank correctly, e.g. "konosuba god's blessing").
    const normalized = query.includes(' ')
      ? query
      : query.replace(/[^a-zA-Z0-9]+/g, '');

    // The NovelArchive API returns the general browse listing (sorted by the
    // site default, not user filters) when `search` is blank, instead of an
    // empty result. So a CJK-only query like "鈴木" — our normalization strips
    // it to "" — or an empty submission would surface the popular/home novels
    // as if they were search hits. Treat a blank normalized query as
    // zero-result so the app shows the standard "no results" state.
    if (!normalized) {
      if (pageNo <= 1) searchSeen.clear();
      return [];
    }

    const fuzzyEnabled = storage.get('fuzzySearch') ?? true;
    const params = new URLSearchParams({
      search: normalized,
      page: String(Math.max(1, pageNo)),
      per_page: '20',
      fuzzy: fuzzyEnabled ? '1' : '0',
    });
    const response = await this.apiGet<NovelsResponse>(
      `/api/novels?${params.toString()}`,
    );

    // A fresh search starts with a clean seen-set so prior searches don't
    // suppress this one's results.
    if (pageNo <= 1) searchSeen.clear();

    const items = this.toNovelItems(response.novels, true);

    // The search API repeats its tail on every page >=2 and never returns an
    // empty page, so the app's infinite-scroll would fetch forever and render
    // duplicate/ghost rows. Drop anything we already returned (by series-key
    // when merge is on, by path otherwise) and, if a page adds nothing new,
    // return [] to tell the app pagination is finished.
    const mergeOn = Boolean(storage.get('mergeSeries'));
    const fresh = items.filter(item => {
      const key = mergeOn ? this.toSeriesKey(item.name || '') : item.path;
      if (!key || searchSeen.has(key)) return false;
      searchSeen.add(key);
      return true;
    });

    return fresh.length ? fresh : [];
  }

  resolveUrl = (path: string, isNovel?: boolean) => {

    const { novelId, chapterNumber } = this.parseChapterPath(path);
    return `${this.site}/reader?novel=${encodeURIComponent(
      novelId,
    )}&chapter=${encodeURIComponent(chapterNumber)}`;
  };

  private async apiGet<T>(path: string): Promise<T> {
    const response = await fetchApi(`${this.site}${path}`, {
      headers: {
        Accept: 'application/json',
        Referer: this.site,
      },
    });

    if ('ok' in response && !response.ok) {
      throw new Error(`NovelArchive request failed: ${path}`);
    }

    return response.json();
  }

  private getPopularEndpoint(
    pageNo: number,
    showLatestNovels: boolean,
    filters: Plugin.PopularNovelsOptions<typeof this.filters>['filters'],
  ): string {
    if (showLatestNovels) {
      // recently-updated supports real pagination via offset (page 2 returns
      // different novels), unlike trending which ignores page/offset and
      // returns identical items — that duplication is what rendered as the
      // "ghost books" on scroll.
      const offset = (Math.max(1, pageNo) - 1) * 20;
      return `/api/novels/recently-updated?limit=20&offset=${offset}`;
    }

    // Default home browse (no active filters) and any sorted/filtered browse
    // all go through the paginated /api/novels endpoint with sort=popular as
    // the default. sort=popular and per_page/page paginate correctly, so the
    // app's infinite list never repeats rows (no ghosts).
    const params = new URLSearchParams({
      page: String(Math.max(1, pageNo)),
      per_page: '20',
    });
    // sort=popular is the default home ranking; the user can override it via
    // the Sort-by filter (Recent/Popular/Top Rated/Chapters). Every value here
    // paginates correctly, so the list never repeats rows (no ghosts).
    const sort = this.cleanText(filters?.sort.value);
    if (sort) {
      params.set('sort', sort);
    }
    const status = this.cleanText(filters?.status.value);
    const includedGenres = this.toStringList(filters?.genre.value.include);
    const excludedGenres = this.toStringList(filters?.genre.value.exclude);

    if (status && status !== 'all') {
      params.set('status', status);
    }

    if (includedGenres.length) {
      params.set('genres_include', includedGenres.join(','));
    }

    if (excludedGenres.length) {
      params.set('genres_exclude', excludedGenres.join(','));
    }

    const genreMatch = this.cleanText(filters?.genreMatch.value);
    if (genreMatch && genreMatch !== 'all') {
      params.set('genre_match', genreMatch); // 'any'
    }

    return `/api/novels?${params.toString()}`;
  }


  private toNovelItems(
    novels: NovelArchiveNovel[] | undefined,
    isSearch = false,
  ): Plugin.NovelItem[] {
    let items = (novels || [])
      .filter((novel): novel is NovelArchiveNovel =>
        Boolean(novel.id && novel.title),
      )
      .map(novel => ({
        name: this.cleanText(novel.title) || 'Untitled',
        path: String(novel.id),
        cover: this.absoluteUrl(
          novel.cover_url || novel.novel_image || novel.image_url,
        ),
      }));

    // The search endpoint returns overlapping IDs across pages (verified:
    // "lotm"/"mother of learning" return the identical set on page 2), which
    // the app's virtualized list re-renders as duplicate "ghost" rows. Drop
    // any duplicate `path` before returning. Browse endpoints paginate
    // cleanly, so this only runs for search.
    if (isSearch) {
      const seen = new Set<string>();
      items = items.filter(item => {
        if (seen.has(item.path)) return false;
        seen.add(item.path);
        return true;
      });
    }

    // Merge volumes is opt-in via the plugin setting "Merge volume variants
    // into one series", read from the host-injected `storage` (top-level
    // `import { storage }`). NovelArchive returns one row per volume with a
    // distinct id, so collapse entries sharing a normalized series name into
    // one row, keeping the lowest volume (e.g. "Vol 1") as the representative.
    // Each survivor keeps its own unique `path`, so the list never renders
    // duplicate/empty "ghost" rows and pagination stops promptly (a collapsed
    // search fits page 1 instead of spawning overlapping pages forever).
    if (!storage.get('mergeSeries')) {
      return items;
    }

    const bySeries = new Map<string, Plugin.NovelItem>();
    for (const item of items) {
      const key = this.toSeriesKey(item.name || '');
      if (!key) {
        bySeries.set(item.path, item);
        continue;
      }
      const existing = bySeries.get(key);
      // Keep the lowest-numbered volume as the representative (so opening it
      // aggregates Vol 1..N), and show the base series title instead of a
      // single volume's name.
      if (
        !existing ||
        this.volumeNumber(item.name) < this.volumeNumber(existing.name)
      ) {
        bySeries.set(key, {
          ...item,
          name: this.cleanText(this.baseTitle(item.name)) || item.name,
        });
      }
    }

    return Array.from(bySeries.values());
  }

  private baseTitle(title: string): string {
    return String(title || '')
      .replace(/,?\s*vol\.?\s*\d+.*$/i, '')
      .replace(/,?\s*volume\s*\d+.*$/i, '')
      .replace(/:\s*book\s*\d+.*$/i, '')
      .replace(/\(light novel[^)]*\)/i, '')
      .trim();
  }

  private volumeNumber(name: string): number {
    const match = name.match(/vol(?:ume)?\.?\s*(\d+)/i);
    return match ? Number(match[1]) : 0;
  }

  private toSeriesKey(title: string): string {
    return title
      // Strip a trailing volume marker in any of these forms so the separate
      // volume entries of one series collapse to the same key:
      //   "Name, Vol 3", "Name Vol 3", "Name Volume 3", "Name (Vol.3)"
      .replace(/,?\s*vol\.?\s*\d+.*$/i, '')
      .replace(/,?\s*volume\s*\d+.*$/i, '')
      .replace(/:\s*book\s*\d+.*$/i, '')
      .replace(/\(light novel[^)]*\)/i, '')
      .replace(/[^a-z0-9]+/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }
  private mergeSearchToken(title: string): string {
    // The source's search ranks short concatenated tokens (e.g. "rezero"
    // surfaces Vol 1..N), whereas the full volume-stripped base title often
    // misses the earliest volumes. Use the lowercased first significant word
    // as a fallback discovery query.
    const base = this.baseTitle(title).replace(/\s+/g, ' ').trim();
    const first = (base.split(' ')[0] || base).replace(/[^a-zA-Z0-9]/g, '');
    return first.toLowerCase();
  }

  private toChapters(
    novelId: string,
    novel: NovelArchiveNovel,
  ): Plugin.ChapterItem[] {
    const names = Array.isArray(novel.chapter_names) ? novel.chapter_names : [];
    const fallbackTotal = this.toPositiveInteger(novel.total_chapters);
    const chapterNames = names.length
      ? names
      : Array.from({ length: fallbackTotal }, (_value, index) => {
          return `Chapter ${index + 1}`;
        });

    return chapterNames.map((name, index) => {
      const fallback = index + 1;
      const chapterNumber = this.chapterNumberFromName(name, fallback);

      return {
        name: this.cleanText(name) || `Chapter ${chapterNumber}`,
        path: `${novelId}/${chapterNumber}`,
        chapterNumber,
      };
    });
  }

  private absoluteUrl(value: string | undefined): string {
    const url = this.cleanText(value);

    if (!url) {
      return defaultCover;
    }

    if (/^https?:\/\//i.test(url)) {
      return url;
    }

    return `${this.site}${url.startsWith('/') ? '' : '/'}${url}`;
  }

  private normalizeGenres(value: string | undefined): string | undefined {
    const genres = String(value || '')
      .split(',')
      .map(genre => genre.trim())
      .filter(Boolean);

    if (!genres.length) {
      return undefined;
    }

    return Array.from(new Set(genres)).join(', ');
  }

  private toNovelStatus(value: string | undefined): string {
    const status = String(value || '').toLowerCase();

    if (status.includes('completed')) {
      return NovelStatus.Completed;
    }

    return NovelStatus.Ongoing;
  }

  private parseChapterPath(chapterPath: string) {
    const [rawNovelId, rawChapterNumber] = chapterPath.split('/');
    const novelId = this.extractNovelId(rawNovelId);
    const chapterNumber = this.toPositiveInteger(rawChapterNumber);

    if (!novelId || !chapterNumber) {
      throw new Error(`Invalid NovelArchive chapter path: ${chapterPath}`);
    }

    return {
      novelId,
      chapterNumber: String(chapterNumber),
    };
  }

  private extractNovelId(path: string): string {
    const value = this.cleanText(path);
    const match = value.match(/[?&]id=([^&]+)/);

    return decodeURIComponent(match?.[1] || value);
  }

  private chapterNumberFromName(name: string, fallback: number): number {
    const match = String(name || '').match(/chapter\s*(\d+)/i);
    const parsed = match ? Number.parseInt(match[1], 10) : NaN;

    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private toPositiveInteger(value: unknown): number {
    const parsed = Number.parseInt(
      String(value ?? '').replace(/[^\d]/g, ''),
      10,
    );

    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private toStringList(value: unknown): string[] {
    return Array.isArray(value)
      ? value.map(item => this.cleanText(item)).filter(Boolean)
      : [];
  }

  private toChapterHtml(text: string): string {
    return String(text || '')
      .split(/\n{2,}/)
      .map(paragraph => paragraph.replace(/\s*\n\s*/g, ' ').trim())
      .filter(Boolean)
      .map(paragraph => `<p>${this.escapeHtml(paragraph)}</p>`)
      .join('');
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private cleanText(value: unknown): string {
    return String(value || '').trim();
  }
}

export default new NovelArchivePlugin();
