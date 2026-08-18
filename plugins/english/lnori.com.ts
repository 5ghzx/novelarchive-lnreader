import { fetchText } from '@libs/fetch';
import { storage } from '@libs/storage';
import { Plugin } from '@/types/plugin';
import { Filters, FilterTypes } from '@libs/filterInputs';
import { load as parseHTML } from 'cheerio';
import { defaultCover } from '@libs/defaultCover';

class LnoriComPlugin implements Plugin.PluginBase {
  id = 'lnori-com';
  name = 'LNORI.com';
  icon = 'src/en/lnori/icon.png';
  site = 'https://lnori.com/';
  version = '1.0.2';
  pluginSettings = {
    mergeCoverTitle: {
      label: 'Merge cover + title page into one entry',
      type: 'Switch',
      value: true,
    },
  };


  // Cached library so the app's infinite-scroll Browse doesn't re-download the
  // full 1.8MB / 884-card library page on every page request (that's what made
  // the main page hang / load "infinitely"). Fetched once, then paginated from
  // memory. The cache is cleared on app restart; a manual pull-to-refresh is
  // unnecessary because the library list itself isn't user-specific.
  private libraryCache:
    | { items: { novel: Plugin.NovelItem; author: string; tags: string[] }[]; at: number }
    | null = null;

  private async getLibraryNovels(): Promise<
    {
      novel: Plugin.NovelItem;
      author: string;
      tags: string[];
    }[]
  > {
    if (this.libraryCache) return this.libraryCache.items;
    const url = this.site + 'library';
    const body = await fetchText(url);
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

    this.libraryCache = { items: parsedList, at: Date.now() };
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
    const body = await fetchText(url);
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

    const dataTagsAttr = $('nav.tags-box.desktop').attr('data-tags');
    if (dataTagsAttr) {
      try {
        const parsedTags = JSON.parse(dataTagsAttr);
        novel.genres = parsedTags
          .map((t: { name: string }) => t.name)
          .join(', ');
      } catch (e) {
        // Fallback below.
      }
    }

    if (!novel.genres) {
      const genres: string[] = [];
      $('nav.tags-box.desktop a, nav.tags-box a').each((i, el) => {
        const text = $(el).text().trim();
        if (text) genres.push(text);
      });
      novel.genres = genres.join(', ');
    }

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
    let chapters: Plugin.ChapterItem[] = [];

    // Deliberately sequential. The official plugin uses Promise.all here,
    // causing every volume page to be fetched and parsed concurrently.
    // Keeping exactly one volume in flight at a time reduces CPU/RAM pressure
    // on low-power/e-ink Android devices.
    for (const volUrl of volumeUrls) {
      const fullVolUrl = this.site.replace(/\/$/, '') + volUrl;
      const volHtml = await fetchText(fullVolUrl);
      const $vol = parseHTML(volHtml);
      const volChapters: Plugin.ChapterItem[] = [];

      const tocLinks = $vol(
        'nav.toc-view a[href^="#"], nav#toc-list a[href^="#"]',
      );

      if (tocLinks.length > 0) {
        tocLinks.each((i, el) => {
          const href = $vol(el).attr('href');
          if (!href) return;
          const id = href.substring(1);
          const tocTitle = $vol(el).text().trim().replace(/\s+/g, ' ');
          const section = $vol(`section#${id}`);
          const h2Title = section
            .find('h2.chapter-title, h2, h3')
            .first()
            .text()
            .trim();
          const chapterName =
            tocTitle || h2Title || `Page ${id.replace(/\D/g, '')}`;
          const volTitle = getVolumeName(volUrl, volumeMap[volUrl]);
          let path = volUrl;
          if (path.startsWith('/')) path = path.substring(1);
          volChapters.push({ name: `${volTitle} - ${chapterName}`, path: path + '#' + id });
        });
      } else {
        $vol('section.chapter').each((i, el) => {
          const id = $vol(el).attr('id');
          if (!id) return;
          const h2Title = $vol(el)
            .find('h2.chapter-title, h2, h3')
            .first()
            .text()
            .trim();
          if (!h2Title) return;
          const volTitle = getVolumeName(volUrl, volumeMap[volUrl]);
          let path = volUrl;
          if (path.startsWith('/')) path = path.substring(1);
          volChapters.push({ name: `${volTitle} - ${h2Title}`, path: path + '#' + id });
        });
      }

      chapters.push(...volChapters);
    }

    // Toggle (default on): fold the "Cover" entry and the following "Title
    // Page" entry into a single "Cover & Title Page" row. They're just image
    // pages with no prose, so as separate TOC rows they're pure pollution.
    if (storage.get('mergeCoverTitle') ?? true) {
      const merged: Plugin.ChapterItem[] = [];
      for (let i = 0; i < chapters.length; i++) {
        const cur = chapters[i];
        const next = chapters[i + 1];
        const isCover = /cover/i.test(cur.name);
        const nextIsTitle = next && /title\s*page/i.test(next.name);
        if (isCover && nextIsTitle) {
          // Keep the cover row, append the title-page anchor so parseChapter
          // renders both images in one entry, then skip the title page.
          const coverAnchor = cur.path.split('#')[1];
          const titleAnchor = next.path.split('#')[1];
          merged.push({
            ...cur,
            name: 'Cover & Title Page',
            path: `${cur.path.split('#')[0]}#${coverAnchor},${titleAnchor}`,
          });
          i++; // consume the title page
          continue;
        }
        merged.push(cur);
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
    const body = await fetchText(url);
    const $ = parseHTML(body);

    const tocAnchors: string[] = [];
    $('nav.toc-view a[href^="#"], nav#toc-list a[href^="#"]').each((i, el) => {
      const href = $(el).attr('href');
      if (href) tocAnchors.push(href.substring(1));
    });

    // Multi-anchor (merged cover+title): concatenate each section's content.
    if (anchors.length > 1) {
      const parts = anchors.map(a => {
        const sel = a ? `section#${a}` : 'section.chapter';
        const sec = $(sel);
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
      });
      return parts.filter(Boolean).join('\n');
    }

    const anchor = anchors[0] || '';
    const chapterSelector = anchor ? `section#${anchor}` : 'section.chapter';
    const section = $(chapterSelector);
    if (!section.length) {
      throw new Error(`Chapter section not found: ${chapterPath}`);
    }

    if (tocAnchors.length > 0 && anchor) {
      const currentIndex = tocAnchors.indexOf(anchor);
      const nextAnchor =
        currentIndex !== -1 && currentIndex + 1 < tocAnchors.length
          ? tocAnchors[currentIndex + 1]
          : null;
      const pagesContent: string[] = [];
      let stepSection = section;

      while (stepSection.length) {
        const mainContent = stepSection.find('.main').length
          ? stepSection.find('.main').clone()
          : stepSection.clone();
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
        const html = mainContent.html();
        if (html) pagesContent.push(html);

        let nextSibling = stepSection.next();
        while (nextSibling.length && !nextSibling.is('section.chapter')) {
          nextSibling = nextSibling.next();
        }
        stepSection = nextSibling;
        if (nextAnchor && stepSection.attr('id') === nextAnchor) break;
      }
      return pagesContent.join('\n');
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
