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

// Discovered volume during merge: id + title (for volume-number sorting)
// + the volume's own cover path (so the merged series can present Vol 1's
// artwork instead of whichever sibling the reader happened to open).
type DiscoveredVolume = { id: string; title: string; image?: string };

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
// seriesKey -> cover image path of the series' lowest volume, captured when
// volume discovery runs (search results carry each volume's cover). Lets the
// merged series present Vol 1's artwork regardless of which sibling id the
// parse was opened from — including when ids come from the session cache.
const seriesCoverImage = new Map<string, string>();

// Session-level memo of each volume's last GOOD (empty-dropped, renumbered)
// chapter list. MMKV (storage) is the durable layer; this Map is the fast
// copy. LNReader's library upserts chapters by (novelId, path) and NEVER
// deletes rows that vanish from a later parse — so a volume whose fetch
// fails during a refresh must contribute its last good list, not silence
// (the "missing volumes" bug: the device lost Vols 1/2/3 of Konosuba in one
// refresh while the server data was verified complete; the loss was purely
// transport). Stale data beats vanished data.
const volumeChapterCache = new Map<string, Plugin.ChapterItem[]>();
// Session memo of each volume's last-scanned RAW signature (parallel to
// volumeChapterCache) so probeWithCache can sig-hit within a session too —
// the base volume is probed in STEP 1 and would otherwise be scanned AGAIN
// when the merge loop reaches it (10 wasted probes per novel).
const volumeSigMemo = new Map<string, string>();
// Per-session cache of fully-read volume HTML (mega reads). Re-opening a
// 300-chapter volume re-fires ~300 paced requests (~80s) — within a single
// session there is no reason to pay that twice. COMPLETE reads only: a
// partial read must stay re-fetchable. Empty string = known-oversize.
const volumeHtmlCache = new Map<string, string>();
const VOLUME_HTML_CACHE_MAX_BYTES = 3_000_000;
// Volume ids kept alive by their cached copy during the CURRENT parse
// (cleared at the start of each merge) — powers the "served from cache"
// banner note.
const staleVolumes = new Set<string>();

// ---------------------------------------------------------------------------
// Request pacing.
//
// The API sits behind Cloudflare rate limiting: once a burst of roughly 40
// requests lands in a few seconds the edge answers EVERYTHING with
// `HTTP 429` + `retry-after: 10` until that window drains. The old code
// treated 429 as a generic error, retried once after 400ms, then dropped the
// chapter — so opening a volume right after another one dropped every
// chapter in it and reported "no readable content" (the Volume 2 field
// report). Measured on the live API: concurrency 8 trips it, sequential
// ~2 rps does not, and a saturated IP recovers in ~12s.
//
// So: one GLOBAL gate in front of every request. It enforces a minimum gap
// between request starts (additively tightened on success, multiplicatively
// widened on pushback) and, when the server says 429, pauses ALL callers for
// its own Retry-After instead of letting each one fail on its own timer.
// Reads then stay just under the limiter instead of tripping it and dying.
const GATE_MIN_GAP_MS = 260; // steady state: ~3.8 requests/second
const GATE_MAX_GAP_MS = 2000; // worst case: one request every 2s
// On success the gap decays MULTIPLICATIVELY back toward the floor, so a
// single good response ends the crawl instead of it outliving the reader's
// patience (an additive -20ms would take ~190 successes to undo a storm).
const GATE_RECOVERY_FACTOR = 0.75;
const GATE_DEFAULT_RETRY_AFTER_MS = 10000; // observed Cloudflare window
const RATE_LIMIT_STATUSES = new Set([429, 503]);
// Patience for one volume read. The reader is blocked on this request and the
// app gives up on it eventually, so a partial volume served inside the budget
// beats a timeout: pass 1 gets its own slice, the rescue pass whatever is left.
const VOLUME_FIRST_PASS_MS = 20000;
const VOLUME_READ_BUDGET_MS = 40000;

// Response shape we rely on; react-native's fetch Response satisfies it, and
// every field is optional so a wrapper without `headers` can't crash us.
type PacedResponse = {
  status?: number;
  ok?: boolean;
  headers?: { get?: (name: string) => string | null };
  json: () => Promise<unknown>;
};

// Three-way verdict: a response we can use, a CONFIRMED absence (404/410 —
// the site's own "Chapter does not exist"), or "unverifiable" (throttled /
// transport failure). Only a confirmed absence may ever drop a chapter.
type PacedResult =
  | { kind: 'ok'; response: PacedResponse }
  | { kind: 'absent' }
  | { kind: 'unavailable' };

class RequestGate {
  private nextSlot = 0;
  private pausedUntil = 0;
  private gapMs = GATE_MIN_GAP_MS;

  async acquire(): Promise<void> {
    const now = Date.now();
    // max() of "when the next slot is free" and "when the rate-limit pause
    // ends" — paused callers all dock at the same deadline, they don't queue
    // up one Retry-After each.
    const start = Math.max(now, this.nextSlot, this.pausedUntil);
    this.nextSlot = start + this.gapMs;
    const wait = start - now;
    if (wait > 0) {
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }

  // Server pushback: hold every request until the Retry-After deadline and
  // halve the steady-state rate (bounded) so the next burst is gentler.
  penalize(waitMs: number): void {
    const until = Date.now() + Math.max(0, waitMs);
    this.pausedUntil = Math.max(this.pausedUntil, until);
    this.nextSlot = Math.max(this.nextSlot, this.pausedUntil);
    this.gapMs = Math.min(GATE_MAX_GAP_MS, Math.round(this.gapMs * 2));
  }

  // Healthy response: back off the throttle toward full speed.
  reward(): void {
    if (this.gapMs > GATE_MIN_GAP_MS) {
      this.gapMs = Math.max(
        GATE_MIN_GAP_MS,
        Math.round(this.gapMs * GATE_RECOVERY_FACTOR),
      );
    }
  }
}

const requestGate = new RequestGate();

class NovelArchivePlugin implements Plugin.PluginBase {
  id = 'novelarchive';
  // REQUIRED by the app's update path: it overwrites the stored row's
  // name/site/lang from THIS evaluated module. A missing field here is how
  // nameless source rows (localeCompare crash) were born. Keep in lockstep
  // with the manifest entry build-dist.mjs generates.
  name = 'Novel Archive';
  version = '1.1.50';
  icon = 'src/en/novelarchive/icon.png';
  site = 'https://novelarchive.cc';
  lang = 'English';
  pluginSettings = {
    mergeSeries: {
      label: 'Merge all volumes into one series',
      type: 'Switch',
      value: true,
    },
    skipUnavailable: {
      label: 'Skip empty chapters (drop & renumber)',
      type: 'Switch',
      value: true,
    },
    mergeVolumesToMega: {
      label: 'Merge chapters into volume mega-chapters',
      type: 'Switch',
      value: true,
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
  private static readonly VOLUME_TIMEOUT_MS = 10000;
  // How many volume fetches run in parallel during the multi-volume merge.
  // On-device testing showed the edge degrades (truncated payloads, hung
  // responses) even at 4 concurrent volume fetches, while every desktop run
  // passes; 2 keeps the in-flight count minimal. Slower, but a clean parse
  // beats a fast broken one, and unchanged volumes skip probes anyway.
  private static readonly VOLUME_CONCURRENCY = 2;
  // Concurrency for the eager "skip unavailable" scan: how many chapter
  // availability probes run in parallel PER VOLUME. Was 64 → 8 after the
  // burst-tarpit findings, now 4: with 2 volume fetches in flight that is
  // at most 8 concurrent requests total, which on-device testing showed is
  // the profile the edge tolerates. First parse of a big series takes a few
  // minutes; every later refresh is probe-free via the signature cache.
  private static readonly SKIP_CONCURRENCY = 4;
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
    // (Skipped entirely when this volume's chapter set is unchanged since its
    // last successful scan — see probeWithCache.)
    // In mega mode the base list is replaced by one row per volume below, so
    // probing it is a wasted ~20-request burst on top of the volume sweeps.
    novel.chapters = this.megaMode()
      ? novel.chapters
      : await this.probeWithCache(id, novel.chapters);

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
                    image:
                      n.cover_url || n.novel_image || n.image_url || undefined,
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
          const seriesCover = collected.find(n => !!n.image)?.image;
          if (seriesCover) seriesCoverImage.set(key, seriesCover);
        } else {
          volCount = ids.length;
        }

        // Bounded-concurrency, retrying volume fetch. 15 simultaneous volume
        // requests — each then fanning out into dozens of availability
        // probes — is exactly the burst that gets Cloudflare-tarpitted on
        // flaky networks, and a tarpitted volume used to resolve as EMPTY
        // and vanish silently ("Konosuba only has volumes 1 and 3").
        staleVolumes.clear();
        const fetchVolumes = (list: string[]) =>
          this.runWithConcurrency(
            list.map(async vid => {
              try {
                return {
                  ok: true as const,
                  chapters: await this.getVolumeChapters(vid),
                };
              } catch {
                return { ok: false as const };
              }
            }),
            NovelArchivePlugin.VOLUME_CONCURRENCY,
          );
        const settled = await fetchVolumes(ids);
        // Rescue pass: a volume that failed outright (degraded edge during its
        // 3 attempts) must not silently cost the reader a whole volume. Once
        // the other volumes have settled — which itself takes a while and
        // gives the edge time to breathe — retry ONLY the failures once.
        const failedIndexes = settled
          .map((s, i) => (!s || !s.ok ? i : -1))
          .filter(i => i >= 0);
        if (failedIndexes.length) {
          await new Promise(r => setTimeout(r, 1500));
          const retried = await fetchVolumes(
            failedIndexes.map(i => ids[i]),
          );
          failedIndexes.forEach((idx, k) => {
            settled[idx] = retried[k];
          });
        }
        const failed = settled.filter(s => !s || !s.ok).length;
        // A volume that fetched "successfully" but contributed ZERO chapters
        // is just as lost as a failed one — count it honestly.
        const empty = settled.filter(s => s && s.ok && !s.chapters.length)
          .length;
        const lost = failed + empty;
        const contributed = ids.length - lost;
        // Volumes kept alive by their cached copy are NOT failures (the list
        // is complete), but the reader should know those rows may be stale.
        const staleCount = staleVolumes.size;
        staleVolumes.clear();
        const merged: Plugin.ChapterItem[] = [];
        let seq = 0;
        for (const s of settled) {
          if (!s?.ok) continue;
          for (const ch of s.chapters) {
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
          // Present the merged SERIES, not the entry volume the reader opened:
          // this parse may have been triggered from any sibling id (e.g. a
          // library row created as "..., Vol. 3"), and the app rewrites the
          // stored row's name/cover from every parse — so the volume's own
          // title/artwork previously stuck to the card forever even though
          // the chapter list now spans all volumes.
          novel.name =
            this.cleanText(this.baseTitle(source.title)) || novel.name;
          const seriesImage = seriesCoverImage.get(key);
          if (seriesImage) {
            novel.cover = this.absoluteUrl(seriesImage);
          }
          novel.chapters = merged;
          let banner = `[${contributed}/${volCount} volumes — ${merged.length} chapters]`;
          if (lost > 0) {
            banner += ` — WARNING: ${lost} volume(s) returned nothing; refresh to retry`;
          } else if (staleCount > 0) {
            banner += ` — ${staleCount} volume(s) served from cache (site busy)`;
          }
          novel.summary = `${banner}\n` + (novel.summary ?? '');
        } else if (lost > 0) {
          // Every volume lost (failed or empty) — do NOT leave a stale/partial
          // list behind.
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

  // Signature of a volume's raw chapter set: count + name list. Same
  // signature => same server data => the availability probe (which only
  // separates server-confirmed 404s from content) cannot yield a different
  // result, so it is SKIPPED and the persisted scan is reused. Removes ~19
  // probes per volume from every refresh (Konosuba: ~300 requests -> ~17),
  // which is what kept tripping the site's rate limiter and wiping volumes.
  // Signature of the RAW chapter set (never of the probed result): it only
  // says "which chapters does this volume list", so it stays valid whichever
  // mode wrote the entry.
  private probeSignature(chapters: Plugin.ChapterItem[]): string {
    return `${chapters.length}:${chapters.map(c => c.name).join('|')}`;
  }

  // Chapter count encoded at the front of a probe signature.
  private sigCount(sig: string): number {
    const n = parseInt(sig, 10);
    return Number.isFinite(n) ? n : 0;
  }

  // `probed` marks entries produced by an actual availability scan. In mega
  // mode the scan is skipped on purpose, so the entry holds the RAW list and
  // says `probed: false` — the read path may use it as a fallback, but the
  // scan path must not mistake it for verified data.
  private readProbeStore(
    volumeId: string,
  ):
    | { sig: string; chapters: Plugin.ChapterItem[]; probed?: boolean }
    | undefined {
    try {
      const cached = storage.get(`naprobe:${volumeId}`) as
        | { sig: string; chapters: Plugin.ChapterItem[]; probed?: boolean }
        | undefined;
      if (cached && typeof cached.sig === 'string' && Array.isArray(cached.chapters)) {
        return cached;
      }
    } catch {
      /* corrupted entry — rescan */
    }
    return undefined;
  }

  // A persisted entry whose chapter array shrank implausibly far below its own
  // signature count (>10%) was written by the 1.1.39/1.1.40 bug: the degraded
  // edge 404s real chapters on-device, and those poisoned filtered lists got
  // persisted under the RAW signature — so every later parse sig-HITS and
  // faithfully serves the poison (Konosuba: 191 of 323, instantly, probe-free).
  // The site's genuine per-volume absence rate is tiny; treat large shrinkage
  // as corruption, ignore the entry, rescan, and overwrite it with good data.
  private static readonly MAX_PLAUSIBLE_DROP_RATIO = 0.1;

  private storeLooksPoisoned(
    cached: { sig: string; chapters: Plugin.ChapterItem[] },
  ): boolean {
    const sigN = this.sigCount(cached.sig);
    if (sigN <= 0) return false;
    const dropped = sigN - cached.chapters.length;
    return dropped > 0 && dropped / sigN > NovelArchivePlugin.MAX_PLAUSIBLE_DROP_RATIO;
  }

  // True when chapters are collapsed into one mega row per volume. In that
  // shape an empty chapter is skipped at READ time (the concatenation drops
  // 404s and keeps the servers' own numbering), so an up-front probe of every
  // chapter buys nothing while costing ~20 requests per volume — ~340 for a
  // 17-volume series in one open. That burst is what tripped the site's rate
  // limiter and made volumes open empty.
  private megaMode(): boolean {
    return Boolean(storage.get('mergeVolumesToMega'));
  }

  // Availability scan with persistence: when the raw chapter set is unchanged
  // since the last successful scan, reuse it; otherwise scan and persist.
  private async probeWithCache(
    volumeId: string,
    raw: Plugin.ChapterItem[],
  ): Promise<Plugin.ChapterItem[]> {
    const sig = this.probeSignature(raw);
    const cached = this.readProbeStore(volumeId);
    // Only a SCANNED entry may short-circuit the scan. A raw mega-mode entry
    // (probed: false) is served by the read path, never as verified data.
    if (cached && cached.probed === true && !this.storeLooksPoisoned(cached)) {
      if (cached.sig === sig) {
        volumeChapterCache.set(volumeId, cached.chapters);
        return cached.chapters;
      }
      // Degraded-detail guard: under load the API returns 200s with a TRUNCATED
      // chapter_names list (a shrunken TOC, not an empty one — that empty case
      // is handled in getVolumeChapters). The site never deletes TOC entries;
      // genuinely dead chapters still appear in the list and are handled by the
      // 404 probe. So a raw list SHORTER than the last good scan can only be
      // degradation, never real data: serve the persisted complete list and keep
      // the longer store entry. Letting the shrink through is what cut Konosuba
      // to 191 of 323 chapters on-device while every volume "succeeded".
      if (this.sigCount(cached.sig) > raw.length) {
        volumeChapterCache.set(volumeId, cached.chapters);
        return cached.chapters;
      }
    }
    // (Poisoned entries fall through to a full rescan, which overwrites them.)
    // Session-level sig hit: same raw set already scanned this session.
    if (volumeSigMemo.get(volumeId) === sig) {
      const memo = volumeChapterCache.get(volumeId);
      if (memo) return memo;
    }
    const scanned = await this.filterUnavailableChapters(raw);
    volumeChapterCache.set(volumeId, scanned);
    volumeSigMemo.set(volumeId, sig);
    // NOTE: persistence happens ONLY with display-ready (renamed) lists in
    // getVolumeChapters, so a sig-hit can never return an intermediate form.
    return scanned;
  }

  // Fetch one volume's chapter list with retries; on total failure serve the
  // last good cached copy (session memo or persisted) instead of vanishing.
  private async getVolumeChapters(
    volumeId: string,
  ): Promise<Plugin.ChapterItem[]> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await Promise.race([
          this.apiGet<NovelResponse>(
            `/api/novels/${encodeURIComponent(volumeId)}`,
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error(`volume ${volumeId} timed out`)),
              NovelArchivePlugin.VOLUME_TIMEOUT_MS,
            );
          }),
        ]);
        const novel = response?.novel;
        // A degraded response (200 with an empty/missing novel body — common
        // on-device under load) is an ERROR, not an empty volume: returning []
        // here silently vanished whole volumes ("no Volume 1") while the
        // banner kept counting them. Throw so it retries, then stale-serves.
        if (
          !novel ||
          !Array.isArray(novel.chapter_names) ||
          novel.chapter_names.length === 0
        ) {
          throw new Error(`volume ${volumeId}: degraded response`);
        }
        const chapters = this.toChapters(volumeId, novel);
        const probed = this.megaMode()
          ? chapters
          : await this.probeWithCache(volumeId, chapters);
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
        // Persist the FINAL (renamed) list under the raw signature so the
        // stale-serve path and the sig-hit path both return display-ready rows.
        // `probed` records whether this entry is a SCANNED list or merely the
        // raw one (mega mode skips the scan), so probeWithCache never serves
        // an unscanned entry as if it were verified.
        volumeChapterCache.set(volumeId, probed);
        try {
          // Never overwrite a longer good scan with a degraded shorter one —
          // the persisted complete list is the fallback every later refresh
          // relies on. Equal counts still rewrite (name/renumber updates).
          const prev = this.readProbeStore(volumeId);
          if (!prev || this.sigCount(prev.sig) <= chapters.length) {
            storage.set(`naprobe:${volumeId}`, {
              sig: this.probeSignature(chapters),
              chapters: probed,
              probed: !this.megaMode(),
            });
          }
        } catch {
          /* caching is best-effort */
        }
        return probed;
      } catch (e) {
        lastError = e;
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 600 * attempt));
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    // All attempts failed. Serve the last good list if we have one — the app
    // never deletes library rows, but it also never re-inserts rows a parse
    // stops returning, so silence here is PERMANENT loss on the device.
    // A healthy persisted scan is preferred; an implausibly-shrunken (poisoned)
    // one is still better than nothing — it beats losing the whole volume, and
    // the poisoned-entry rescan in probeWithCache repairs it on the next
    // healthy fetch.
    const memo = volumeChapterCache.get(volumeId);
    const persisted = this.readProbeStore(volumeId);
    const stale =
      memo && memo.length
        ? memo
        : persisted && persisted.chapters.length
          ? persisted.chapters
          : undefined;
    if (stale && stale.length) {
      staleVolumes.add(volumeId);
      return stale;
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(`volume ${volumeId} failed after 3 attempts`);
  }
  private async probeChapterAvailable(
    novelId: string,
    chapterNumber: number,
  ): Promise<boolean> {
    // A CONFIRMED 404/410 means the chapter is genuinely absent -> drop it.
    // Anything else — a 429 rate limit, a 5xx, a degraded 200, a network
    // error — is UNVERIFIABLE, so we keep the chapter. (Previously a thrown
    // error returned false, which made a single bad probe drop the chapter;
    // on a rate-limited device enough probes failed that whole volumes
    // collapsed.)
    const result = await this.fetchPaced(
      `${this.site}/api/novels/${encodeURIComponent(
        novelId,
      )}/chapters/${encodeURIComponent(String(chapterNumber))}`,
    );
    return result.kind !== 'absent';
  }

  // Eager mode: probe every chapter in parallel (bounded by
  // SKIP_CONCURRENCY), drop the ones CONFIRMED absent, and renumber
  // the survivors 1..N. Runs once; the app caches the resulting list. A probe
  // failure means "keep" -- we don't drop a chapter we couldn't verify.
  private async filterUnavailableChapters(
    chapters: Plugin.ChapterItem[],
  ): Promise<Plugin.ChapterItem[]> {
    if (!chapters.length) return chapters;
    // Only drop when both the scan AND a re-probe agree the chapter is gone.
    const tasks = chapters.map(async ch => {
      const [novelId, num] = ch.path.split('/');
      const available = await this.probeChapterAvailable(novelId, Number(num));
      // Unverifiable (network error) -> keep, don't drop.
      return available ? ch : { ch, dropped: true as const };
    });
    const settled = await this.runWithConcurrency(
      tasks,
      NovelArchivePlugin.SKIP_CONCURRENCY,
    );
    // Second look before any drop: the degraded edge answers REAL chapters
    // with the same 404 body it uses for genuine absences. A real absence
    // stays 404 on re-probe; a degraded one flips to 200. Without this the
    // device wiped ~7 chapters per volume into the persisted cache.
    const firstPassDropped = settled
      .filter(
        (s): s is { ch: Plugin.ChapterItem; dropped: true } =>
          s !== null && 'dropped' in s,
      )
      .map(s => s.ch);
    const reprobeTasks = firstPassDropped.map(async ch => {
      const [novelId, num] = ch.path.split('/');
      const stillGone = !(await this.probeChapterAvailable(
        novelId,
        Number(num),
      ));
      return stillGone ? ch : null; // recovered on re-probe -> keep
    });
    const confirmedDropped = (
      await this.runWithConcurrency(reprobeTasks, 2)
    ).filter((c): c is Plugin.ChapterItem => c !== null);
    // Mass-drop circuit breaker: if this scan "dropped" more than 10% of the
    // volume, the verdicts are degradation, not data (the site's real absence
    // rate per volume is tiny). Trust nothing from this scan: keep the whole
    // raw list. Genuine dead chapters simply fail at read time, where the
    // reader skips them — visible-with-warts beats silently missing volumes.
    if (
      confirmedDropped.length > 0 &&
      confirmedDropped.length / chapters.length >
        NovelArchivePlugin.MAX_PLAUSIBLE_DROP_RATIO
    ) {
      return chapters;
    }
    const confirmedPaths = new Set(confirmedDropped.map(c => c.path));
    // Preserve original order while removing only confirmed absences.
    const kept = chapters.filter(ch => !confirmedPaths.has(ch.path));
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

    // Create one mega chapter per (non-empty) volume. The path is STABLE
    // ("volumeId/M/V<vol>") and carries NO per-chapter data: the chapter list
    // is resolved live at open time. The previous format embedded the probed
    // chapter numbers in the path; probe verdicts legitimately vary between
    // refreshes ("keep on doubt"), so the path changed and LNReader's
    // (novelId, path) upsert — which never deletes rows missing from a later
    // list — kept the old row too: the duplicate "Volume 1 (Full)" bug.
    const mega: Plugin.ChapterItem[] = [];
    for (const vol of sortedVols) {
      const volChapters = byVolume.get(vol)!;
      const volumeId = volChapters[0].path.split('/')[0];
      mega.push({
        name: `Volume ${vol} (Full)`,
        path: `${volumeId}/M/V${vol}`,
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
    // Each chapter is fetched through the global pacer, and the outcome is
    // recorded three ways: content, a CONFIRMED absence (404/410 — the site's
    // own "Chapter does not exist"), or a failure (throttled / degraded /
    // transport). Only a confirmed absence may legitimately reduce a volume,
    // so failures are retried in a rescue pass rather than dropped — that
    // distinction is what fixes "Volume 2 → 0 readable content": previously
    // every 429 was retried once after 400ms, counted as unreadable, and the
    // volume collapsed.
    const chapterUrl = (ch: Plugin.ChapterItem) => {
      const [, num] = ch.path.split('/');
      return (
        `${this.site}/api/novels/${encodeURIComponent(volumeId)}` +
        `/chapters/${encodeURIComponent(String(num))}`
      );
    };
    // Session cache: a complete read of this volume already happened this
    // session — serve it instead of re-firing ~300 paced requests (~80s).
    const cached = volumeHtmlCache.get(volumeId);
    if (cached) return cached;
    const fetchOne = async (
      ch: Plugin.ChapterItem,
      deadline: number,
    ): Promise<{ html?: string; absent?: true; failed?: true }> => {
      // Two attempts per chapter: the pacer already holds every caller for
      // the server's Retry-After, so extra per-chapter retries mostly add lag
      // to a reader waiting on the page. The rescue pass below is the second
      // line of defence, and it is deadline-bounded.
      const result = await this.fetchPaced(chapterUrl(ch), 2, deadline);
      if (result.kind === 'absent') return { absent: true };
      if (result.kind === 'unavailable') return { failed: true };
      try {
        const payload = (await result.response.json()) as ChapterResponse;
        const content = payload.chapter?.content;
        // A degraded 200 with no body is NOT an absence — it is the site
        // shedding load, so it must be retried, never silently skipped.
        if (!content) return { failed: true };
        return { html: `<h2>${ch.name}</h2>\n${this.toChapterHtml(content)}` };
      } catch {
        return { failed: true };
      }
    };

    // A volume read gets one patience budget for all of its passes: pass 1
    // gets a slice, the rescue pass whatever remains. Without this, a device
    // the site is refusing outright would sit through every Retry-After of
    // every chapter (~58s measured) and trip the reader's own timeout.
    //
    // The runner gets the SAME deadline: with lazy task factories, workers
    // refuse to start chapters past it, so total time is actually bounded
    // (an eager promise list would pre-book pacer slots for the whole queue
    // and run 145s "within" a 40s budget — measured live).
    const deadline = Date.now() + VOLUME_READ_BUDGET_MS;
    const firstPassDeadline = Math.min(
      deadline,
      Date.now() + VOLUME_FIRST_PASS_MS,
    );
    const outcomes = await this.runWithConcurrency(
      chapters.map(ch => () => fetchOne(ch, firstPassDeadline)),
      6,
      firstPassDeadline,
    );

    // Rescue pass: only the chapters that FAILED for a reason other than
    // confirmed absence. The gate held every request for the server's
    // Retry-After, so by now the rate-limit window has drained. Skipped when
    // the reader has already waited most of its patience — a slow page is not
    // worth a timeout error, and whatever came back is served instead.
    const retryIndexes = outcomes
      .map((o, i) => (o && o.failed ? i : -1))
      .filter(i => i >= 0);
    if (retryIndexes.length && Date.now() < deadline) {
      const retried = await this.runWithConcurrency(
        retryIndexes.map(i => () => fetchOne(chapters[i], deadline)),
        3,
        deadline,
      );
      retryIndexes.forEach((chapterIndex, slot) => {
        const outcome = retried[slot];
        if (outcome && outcome.html) outcomes[chapterIndex] = outcome;
      });
    }

    const html = outcomes
      .filter((o): o is { html: string } => Boolean(o && o.html))
      .map(o => o.html)
      .join('\n<hr/>\n');
    if (html) {
      // Partial (a chapter genuinely 404'd) is far better than an error page.
      // Cache when COMPLETE — every slot resolved to content or a CONFIRMED
      // absence. Absent chapters are permanently absent (verified 404), so a
      // read with absents is still final and re-opening it must not re-fire
      // the whole paced crawl. Only "failed" slots (throttled/degraded) keep
      // a volume uncached so a re-open retries them.
      if (outcomes.every(o => o && (o.html || o.absent))) {
        volumeHtmlCache.set(
          volumeId,
          html.length <= VOLUME_HTML_CACHE_MAX_BYTES ? html : '',
        );
      }
      return html;
    }
    const absent = outcomes.filter(o => o && o.absent).length;
    if (absent === chapters.length) {
      throw new Error(
        'NovelArchive has no readable chapters stored for this volume.',
      );
    }
    throw new Error(
      'NovelArchive is rate-limiting this device (HTTP 429) — wait about a minute, then reopen the volume.',
    );
  }

  // Resolve a stable mega path ("volumeId/M/V<vol>") to its chapter list at
  // open time: fetch the volume's chapter names from the API, then drop the
  // chapters the availability probe confirms are empty. The probe is
  // best-effort (a failed/timeout probe KEEPS the chapter, and
  // fetchAndConcat skips late 404s while renumbering headers), so a flaky
  // connection can at worst add a "<missing>" header — it can never
  // duplicate or remove a chapter row, because the mega path itself is
  // constant across refreshes.
  private async fetchVolumeChapterList(
    volumeId: string,
    vol: string,
  ): Promise<Plugin.ChapterItem[]> {
    let chapters: Plugin.ChapterItem[] = [];
    try {
      const response = await this.apiGet<NovelResponse>(
        `/api/novels/${encodeURIComponent(volumeId)}`,
      );
      chapters = this.toChapters(volumeId, response?.novel ?? {});
    } catch {
      /* degraded detail fetch — fall back to the persisted scan below */
    }
    if (!chapters.length) {
      // The last good scan of this volume (written by parseNovel) keeps the
      // mega chapter readable when the live detail fetch degrades.
      chapters = this.readProbeStore(volumeId)?.chapters ?? [];
    }
    if (!chapters.length) {
      throw new Error(`NovelArchive volume not found: ${volumeId}`);
    }
    // NO availability probing here. The reader is about to fetch every
    // chapter's content anyway, and fetchAndConcatVolumeChapters already skips
    // chapters that are genuinely absent. Probing first doubled the request
    // count AND turned one degraded burst into "no readable content" for the
    // whole volume (the field report for Volume 2), so the numbers stay the
    // site's own: a skipped chapter leaves its number missing, never shifted.
    return chapters.map(ch => ({
      ...ch,
      name: /^volume\s+\d+/i.test(ch.name)
        ? ch.name
        : `Volume ${vol} ${ch.name}`,
    }));
  }
  // Run async tasks with a bounded concurrency limit, preserving input order.
  // Runs promise-producing tasks with bounded concurrency. EVERY slot of the
  // result array is always written: a task that rejects stores `undefined`,
  // and no slot can be left unassigned. The previous callback-chained version
  // could leave a SPARSE HOLE (confirmed on-device: index 0 of 17), and holes
  // are skipped by Array.prototype.filter/map — so a whole volume vanished
  // while `lost` stayed 0 and the banner happily reported 17/17. Missing vs
  // failed matters here: callers rely on `!result` to count and retry losses.
  //
  // Tasks are LAZY FACTORIES (or promises — both accepted). This matters: a
  // plain promise created up front starts executing immediately, and since
  // every task begins with `gate.acquire()`, a 300-chapter volume enqueued
  // 300 gate slots at CREATION time — the "deadline" could no longer bound
  // anything (measured: a 40s-budget read ran 145s because the queue was
  // pre-booked for 78s of pacer slots before the first fetch even fired).
  // With factories, a task reserves its slot only when a worker STARTS it, so
  // workers can also refuse to begin work past a deadline.
  private async runWithConcurrency<T>(
    tasks: (Promise<T> | (() => Promise<T>))[],
    limit: number,
    deadline = Number.POSITIVE_INFINITY,
  ): Promise<T[]> {
    const results: (T | undefined)[] = new Array(tasks.length).fill(
      undefined,
    );
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const i = cursor++;
        if (i >= tasks.length) return;
        // Don't START new work past the deadline. Tasks already running are
        // left to finish (their own deadline bounds them); unstarted slots
        // stay `undefined`, which callers already count as "failed".
        if (Date.now() >= deadline) return;
        const task = tasks[i];
        try {
          results[i] =
            typeof task === 'function'
              ? await (task as () => Promise<T>)()
              : await task;
        } catch {
          results[i] = undefined;
        }
      }
    };
    const workerCount = Math.max(1, Math.min(limit, tasks.length));
    await Promise.all(
      Array.from({ length: workerCount }, () => worker()),
    );
    return results as T[];
  }

  async parseChapter(chapterPath: string): Promise<string> {
    // Mega chapter paths. STABLE format: "volumeId/M/V<vol>" — deliberately
    // carries NO per-chapter data. LNReader's library upserts chapters keyed
    // by (novelId, path) and never deletes rows that vanish from a later
    // parse, so any probe-dependent data in the path (the chapter-number list
    // this used to embed) mints a brand-new row on the next refresh whenever
    // the probe verdicts differ — the duplicate "Volume 1 (Full)" bug. The
    // path therefore never changes between refreshes; content is resolved
    // live in fetchVolumeChapterList.
    const stableMega = chapterPath.match(/^(.+)\/M\/V(\d+)$/);
    if (stableMega) {
      const [, volumeId, vol] = stableMega;
      const chapters = await this.fetchVolumeChapterList(volumeId, vol);
      return this.fetchAndConcatVolumeChapters(volumeId, chapters);
    }
    // LEGACY format (<= 1.1.35): "volumeId/M/V<vol>/num1,num2,..." already
    // persisted in existing libraries — still parseable so old mega rows
    // keep opening after the update.
    const legacyMega = chapterPath.match(/^(.+)\/M\/V(\d+)\/(.+)$/);
    if (legacyMega) {
      const [, volumeId, vol, nums] = legacyMega;
      const chapters = nums
        .split(',')
        .filter(Boolean)
        .map(num => ({
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

  // Shared request headers. Honest client identity: the app injects a WebView
  // Chrome UA by default, and a browser-claiming UA over the app's
  // non-browser TLS stack is exactly the fingerprint mismatch that got
  // lnori.com's zone (and r.jina.ai) to mistreat the app's requests, and is
  // the prime suspect for NA's edge degrading bursts on-device only.
  private apiHeaders() {
    return {
      Accept: 'application/json',
      Referer: this.site,
      'User-Agent':
        'LNReader/2.1.0 (plugin: novelarchive; +https://github.com/5ghzx/novelarchive-lnreader)',
    };
  }

  // Milliseconds the server asked us to wait, from its own Retry-After
  // header (Cloudflare sends `retry-after: 10` here). Falls back to the
  // observed window; capped so a hostile value can't hang the reader.
  private retryAfterMs(response: PacedResponse): number {
    try {
      const raw = response?.headers?.get?.('retry-after');
      const seconds = Number.parseInt(String(raw ?? ''), 10);
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, 60000);
      }
    } catch {
      /* no header access on this fetch wrapper */
    }
    return GATE_DEFAULT_RETRY_AFTER_MS;
  }

  // The ONLY way this plugin talks to the site. Every request goes through the
  // global gate, and a rate-limited or broken response is retried (honoring
  // the server's Retry-After) rather than being mistaken for data — a 429 is
  // the site saying "later", never "this chapter doesn't exist".
  private async fetchPaced(
    url: string,
    attempts = 3,
    deadline = Number.POSITIVE_INFINITY,
  ): Promise<PacedResult> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (Date.now() >= deadline) return { kind: 'unavailable' };
      await requestGate.acquire();
      // The gate may have parked us behind a Retry-After that outlasts this
      // request's deadline — bail out instead of starting a doomed fetch.
      if (Date.now() >= deadline) return { kind: 'unavailable' };
      try {
        const response = (await fetchApi(url, {
          headers: this.apiHeaders(),
        })) as PacedResponse;
        const status = Number(response?.status ?? 0);
        if (status === 404 || status === 410) {
          return { kind: 'absent' };
        }
        if (RATE_LIMIT_STATUSES.has(status)) {
          requestGate.penalize(this.retryAfterMs(response));
          continue;
        }
        if ('ok' in response && !response.ok) {
          throw new Error(`HTTP ${status}`);
        }
        requestGate.reward();
        return { kind: 'ok', response };
      } catch {
        if (attempt === attempts) return { kind: 'unavailable' };
        // Transport failure: brief bespoke pause, then the gate re-schedules.
        requestGate.penalize(300 * attempt);
        await new Promise(resolve => setTimeout(resolve, 200 * attempt));
      }
    }
    return { kind: 'unavailable' };
  }

  private async apiGet<T>(path: string, attempts = 3): Promise<T> {
    const result = await this.fetchPaced(`${this.site}${path}`, attempts);

    if (result.kind !== 'ok') {
      // Never silently accept a failed call as "empty": callers distinguish
      // degradation (keep what we have, retry) from real absence.
      throw new Error(
        result.kind === 'absent'
          ? `NovelArchive not found: ${path}`
          : `NovelArchive request failed: ${path}`,
      );
    }

    return (await result.response.json()) as T;
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
