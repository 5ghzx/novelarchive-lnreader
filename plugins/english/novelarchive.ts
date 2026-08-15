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

class NovelArchivePlugin implements Plugin.PluginBase {
  id = 'novelarchive2';
  name = 'Novel Archive';
  icon = 'src/en/novelarchive/icon.png';
  site = 'https://novelarchive.cc';
  version = '1.1.15';
  pluginSettings = {
    mergeSeries: {
      label: 'Merge volume variants into one series',
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
  private searchSeen = new Set<string>();

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
    // their chapters (deduped by number, sorted ascending) so one row exposes
    // the full series contiguously.
    const mergeOn = Boolean(storage.get('mergeSeries'));
    if (mergeOn) {
      try {
        const key = this.toSeriesKey(source.title);
        const fuzzyEnabled = storage.get('fuzzySearch') ?? true;
        const queries = [
          this.mergeSearchToken(source.title), // e.g. "rezero" -- catches Vol 1
          this.baseTitle(source.title), // full base title
        ].filter(Boolean);

        const volumeIds = new Map<string, string>();
        for (const q of queries) {
          const search = await this.apiGet<NovelsResponse>(
            `/api/novels?search=${encodeURIComponent(q)}&per_page=50&fuzzy=${
              fuzzyEnabled ? '1' : '0'
            }`,
          );
          for (const n of search.novels || []) {
            if (this.toSeriesKey(n.title) !== key) continue;
            const vid = String(n.id);
            if (vid) volumeIds.set(vid, vid);
          }
        }
        const ids = Array.from(volumeIds.values()).slice(0, 30);

        const seen = new Set<number>();
        const merged: Plugin.ChapterItem[] = [];
        for (const vid of ids) {
          const items = await this.fetchVolumeChapters(vid);
          for (const ch of items) {
            if (seen.has(ch.chapterNumber)) continue;
            seen.add(ch.chapterNumber);
            merged.push(ch);
          }
        }
        merged.sort((a, b) => a.chapterNumber - b.chapterNumber);
        if (merged.length) {
          novel.chapters = merged;
          novel.name = `${novel.name} · MERGED ${ids.length}vols/${merged.length}ch`;
        } else {
          novel.name = `${novel.name} · MERGE-EMPTY(${ids.length}vols)`;
        }
      } catch (e) {
        novel.name = `${novel.name} · MERGE-ERR(${String((e as Error)?.message || e).slice(0,40)})`;
      }
    } else {
      novel.name = `${novel.name} · MERGE-OFF`;
    }

    return novel;
  }

  private async fetchVolumeChapters(
    volumeId: string,
  ): Promise<Plugin.ChapterItem[]> {
    const response = await this.apiGet<NovelResponse>(
      `/api/novels/${encodeURIComponent(volumeId)}`,
    );
    const novel = response.novel;
    if (!novel) return [];
    // Path encodes the volume id so parseChapter resolves the right chapter.
    return this.toChapters(volumeId, novel);
  }

  async parseChapter(chapterPath: string): Promise<string> {
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
    if (pageNo <= 1) this.searchSeen.clear();

    const items = this.toNovelItems(response.novels, true);

    // The search API repeats its tail on every page >=2 and never returns an
    // empty page, so the app's infinite-scroll would fetch forever and render
    // duplicate/ghost rows. Drop anything we already returned (by series-key
    // when merge is on, by path otherwise) and, if a page adds nothing new,
    // return [] to tell the app pagination is finished.
    const mergeOn = Boolean(storage.get('mergeSeries'));
    const fresh = items.filter(item => {
      const key = mergeOn ? this.toSeriesKey(item.name || '') : item.path;
      if (!key || this.searchSeen.has(key)) return false;
      this.searchSeen.add(key);
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
          name: `${this.cleanText(this.baseTitle(item.name)) || item.name} · MERGE-ON`,
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
