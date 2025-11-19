const fs = require('fs');
const slugify = require('../../lib/slugify');

const escapeRegExp = (value) => value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

const toHtmlParagraphs = (text) => {
  if (!text) return '';
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${line}</p>`)
    .join('\n      ');
};

const formatDateParts = (value) => {
  if (!value) {
    const now = new Date();
    return {
      dotted: '',
      verbose: '',
      year: now.getFullYear(),
    };
  }
  const normalized = value.replace(/\//g, '-');
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    return {
      dotted: value,
      verbose: value,
      year: now.getFullYear(),
    };
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return {
    dotted: `${y}.${m}.${d}`,
    verbose: `${y}年${m}月${d}日`,
    year: y,
  };
};

const slugifyHeading = (heading, index = 0) => {
  const base = heading || `section-${index + 1}`;
  const slug = base
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s・、。/]+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `section-${index + 1}`;
};

const createTemplateRenderer = ({ templatePath }) => {
  let cachedArticleTemplate = null;
  let articleTemplateLoaded = false;

  const getArticleTemplate = () => {
    if (articleTemplateLoaded) return cachedArticleTemplate;
    try {
      cachedArticleTemplate = fs.readFileSync(templatePath, 'utf-8');
    } catch (error) {
      cachedArticleTemplate = null;
      console.warn('[generator] 記事テンプレートの読み込みに失敗しました:', error.message);
    } finally {
      articleTemplateLoaded = true;
    }
    return cachedArticleTemplate;
  };

  const renderArticleTemplate = (slots) => {
    const template = getArticleTemplate();
    if (!template) return null;
    return Object.entries(slots).reduce((html, [token, value]) => {
      const safeValue = value ?? '';
      const pattern = new RegExp(escapeRegExp(token), 'g');
      return html.replace(pattern, safeValue);
    }, template);
  };

  const compileArticleHtml = (article, meta, options = {}) => {
    const assetBase = typeof options.assetBase === 'string' ? options.assetBase : '../';
    const normalizedAssetBase = assetBase.endsWith('/') ? assetBase : `${assetBase}/`;
    const cssHref = `${normalizedAssetBase}assets/css/style.css`;
    const mainJsSrc = `${normalizedAssetBase}assets/js/main.js`;
    const articleJsSrc = `${normalizedAssetBase}assets/js/article.js`;

    const sections = Array.isArray(article.sections) ? article.sections : [];
    const tags = Array.isArray(article.tags) ? article.tags : [];

    const dateParts = formatDateParts(meta.date);
    const displayDate = dateParts.dotted || meta.date || '';
    const verboseDate = dateParts.verbose || meta.date || '';
    const heroImage = (meta && meta.image) || options.image || null;
    const heroImageSrc = heroImage?.src ? `${normalizedAssetBase}${heroImage.src}` : null;
    const socialImage = heroImageSrc || `${normalizedAssetBase}assets/img/ogp-default.svg`;

    const renderTagList = (items) => {
      if (!Array.isArray(items) || items.length === 0) {
        return '';
      }
      const tagItems = items
        .map((tagItem) => {
          if (!tagItem) return '';
          if (typeof tagItem === 'string') {
            const fallbackSlug = slugify(tagItem, 'tag');
            return `<li class="tag" data-tag-slug="${fallbackSlug}">${tagItem}</li>`;
          }
          const label = tagItem.label || tagItem.slug || '';
          if (!label) return '';
          const slugAttr = tagItem.slug ? ` data-tag-slug="${tagItem.slug}"` : '';
          const categoryAttr = tagItem.category
            ? ` data-tag-category="${tagItem.category}"`
            : '';
          const styleAttr = tagItem.style ? ` data-tag-style="${tagItem.style}"` : '';
          return `<li class="tag"${slugAttr}${categoryAttr}${styleAttr}>${label}</li>`;
        })
        .filter(Boolean)
        .join('\n          ');
      if (!tagItems) return '';
      return `<ul class="article-tags">
          ${tagItems}
        </ul>`;
    };

    const tagMarkup = renderTagList(tags);

    const renderMetaGrid = () => {
      const cards = [];
      if (verboseDate || displayDate) {
        cards.push(`
          <article class="meta-card">
            <p class="meta-label">公開日</p>
            <p class="meta-value">${verboseDate || displayDate}</p>
            ${displayDate ? `<small>最終更新: ${displayDate}</small>` : ''}
          </article>`);
      }

      if (meta?.sourceName || meta?.sourceUrl) {
        const label = meta.sourceName || 'リサーチソース';
        const link = meta.sourceUrl
          ? `<a href="${meta.sourceUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`
          : label;
        cards.push(`
          <article class="meta-card">
            <p class="meta-label">リサーチソース</p>
            <p class="meta-value">${link}</p>
            ${meta.sourceUrl ? '<small>外部リンク</small>' : ''}
          </article>`);
      }

      if (meta?.videoUrl) {
        const videoLabel = meta.videoTitle || '参照動画を再生';
        cards.push(`
          <article class="meta-card">
            <p class="meta-label">参照動画</p>
            <p class="meta-value"><a href="${meta.videoUrl}" target="_blank" rel="noopener noreferrer">${videoLabel}</a></p>
            <small>YouTube</small>
          </article>`);
      }

      if (!cards.length) return '';

      return `
        <div class="article-meta-grid">
${cards.join('\n')}
        </div>`;
    };

    const metaGridMarkup = renderMetaGrid();

    const shareLinksMarkup = `
        <div class="article-share-links">
          <a class="share-link" href="#" data-share-target="x" aria-label="Xで共有">Xに共有</a>
          <a class="share-link" href="#" data-share-target="linkedin" aria-label="LinkedInで共有">LinkedIn</a>
          <button class="share-link" type="button" data-share-target="native">端末で共有</button>
          <button class="share-link copy-link" type="button" data-copy-link>リンクをコピー</button>
        </div>`;

    const adTopMarkup = `
      <!-- Google AdSense: 記事上広告 -->
      <!--
      <div class="inner">
        <div class="ad-container ad-article-top">
          <span class="ad-label">広告</span>
          <ins class="adsbygoogle"
               style="display:block"
               data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
               data-ad-slot="YYYYYYYYYY"
               data-ad-format="auto"
               data-full-width-responsive="true"></ins>
          <script>
            (adsbygoogle = window.adsbygoogle || []).push({});
          </script>
        </div>
      </div>
      -->
`;

    const adMiddleMarkup = `
            <!-- Google AdSense: 記事中広告 -->
            <!--
            <div class="ad-container ad-article-middle">
              <span class="ad-label">広告</span>
              <ins class="adsbygoogle"
                   style="display:block"
                   data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
                   data-ad-slot="YYYYYYYYYY"
                   data-ad-format="rectangle"></ins>
              <script>
                (adsbygoogle = window.adsbygoogle || []).push({});
              </script>
            </div>
            -->
`;

    const adBottomMarkup = `
      <!-- Google AdSense: 記事下広告 -->
      <!--
      <div class="inner">
        <div class="ad-container ad-article-bottom">
          <span class="ad-label">広告</span>
          <ins class="adsbygoogle"
               style="display:block"
               data-ad-client="ca-pub-XXXXXXXXXXXXXXXX"
               data-ad-slot="YYYYYYYYYY"
               data-ad-format="auto"
               data-full-width-responsive="true"></ins>
          <script>
            (adsbygoogle = window.adsbygoogle || []).push({});
          </script>
        </div>
      </div>
      -->
`;

    const renderSubSections = (subSections = [], parentIndex = 0) => {
      if (!Array.isArray(subSections) || subSections.length === 0) {
        return '';
      }
      return subSections
        .map((subSection, childIndex) => {
          const heading = subSection.heading || `ポイント${parentIndex + 1}-${childIndex + 1}`;
          const body = toHtmlParagraphs(subSection.body || subSection.content || '');
          if (!body) return '';
          return `
              <div class="article-subsection">
                <h3 class="subsection-heading">${heading}</h3>
                <div class="subsection-body">
                  ${body}
                </div>
              </div>`;
        })
        .filter(Boolean)
        .join('\n');
    };

    const sectionMarkup = sections
      .map((section, index) => {
        const heading = section.heading ?? `セクション${index + 1}`;
        const slug = slugifyHeading(heading, index);
        const overview = toHtmlParagraphs(section.overview || section.body || '');
        const subSections = renderSubSections(section.subSections, index);
        const overviewMarkup = overview ? `<div class="section-overview">${overview}</div>` : '';

        const adInsert = index === 0 ? adMiddleMarkup : '';

        return `
            <section class="article-section" id="${slug}">
              <h2 class="section-heading">${heading}</h2>
              ${overviewMarkup}
              ${subSections}
            </section>${adInsert}`;
      })
      .join('\n');

    const introMarkup = article.intro
      ? `
        <section class="article-intro-block">
          <div class="intro-content">
${toHtmlParagraphs(article.intro)}
          </div>
        </section>`
      : '';

    const conclusionMarkup = article.conclusion
      ? `
      <section class="article-conclusion inner">
        <h2 class="conclusion-heading">まとめ</h2>
        <div class="conclusion-content">
${toHtmlParagraphs(article.conclusion)}
        </div>
      </section>`
      : '';

    const summaryText = article.summary ?? '';
    const publishedTimeIso = displayDate ? `${displayDate}T00:00:00+09:00` : new Date().toISOString();

    const templateSlots = {
      '{{ASSET_BASE}}': normalizedAssetBase,
      '{{TITLE}}': article.title,
      '{{SUMMARY}}': summaryText,
      '{{SOCIAL_IMAGE}}': socialImage,
      '{{PUBLISHED_AT_ISO}}': publishedTimeIso,
      '{{DISPLAY_DATE}}': displayDate,
      '{{TAG_MARKUP}}': tagMarkup,
      '{{META_GRID}}': metaGridMarkup,
      '{{SHARE_LINKS}}': shareLinksMarkup,
      '{{AD_TOP}}': adTopMarkup,
      '{{INTRO_MARKUP}}': introMarkup,
      '{{SECTION_MARKUP}}': sectionMarkup,
      '{{AD_BOTTOM}}': adBottomMarkup,
      '{{CONCLUSION_MARKUP}}': conclusionMarkup,
    };

    const templatedHtml = renderArticleTemplate(templateSlots);
    if (templatedHtml) {
      return templatedHtml;
    }

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${article.title} | AI情報ブログ</title>
  <meta name="description" content="${summaryText}">

  <script src="${normalizedAssetBase}assets/js/analytics.js"></script>

  <!-- Google AdSense -->
  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXXXXXXXXXXXXX"
       crossorigin="anonymous"></script>

  <!-- ファビコン -->
  <link rel="icon" type="image/svg+xml" href="${normalizedAssetBase}assets/img/logo.svg">
  <link rel="apple-touch-icon" href="${normalizedAssetBase}assets/img/logo.svg">

  <!-- Open Graph / SNS共有 -->
  <meta property="og:type" content="article">
  <meta property="og:title" content="${article.title} | AI情報ブログ">
  <meta property="og:description" content="${summaryText}">
  <meta property="og:image" content="${socialImage}">
  <meta property="og:site_name" content="AI情報ブログ">
  <meta property="og:locale" content="ja_JP">
  <meta property="article:published_time" content="${publishedTimeIso}">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${article.title} | AI情報ブログ">
  <meta name="twitter:description" content="${summaryText}">
  <meta name="twitter:image" content="${socialImage}">

  <link rel="stylesheet" href="${cssHref}">
</head>
<body class="article-page">
  <!-- ヘッダーはcomponents.jsで動的に挿入されます -->

  <main>
    <article class="article-detail">
      <section class="inner article-hero">
        <p class="article-eyebrow">Daily Briefing</p>
        <div class="article-hero-layout">
          <div class="article-hero-main">
            <p class="post-meta">${displayDate}</p>
            <h1>${article.title}</h1>
            <p class="article-summary">${summaryText}</p>
          </div>
        </div>

        ${tagMarkup}
      </section>

      ${adTopMarkup}

      <div class="inner article-grid">
        <div class="article-main-column">
          <article class="post-article article-content">
${introMarkup}
${sectionMarkup}
          </article>
        </div>

        <aside class="article-sidebar" aria-label="補足情報">
          <section class="article-card article-toc">
            <p class="article-card-label">目次</p>
            <ol class="toc-list" data-toc-list aria-live="polite"></ol>
          </section>
        </aside>
      </div>

      ${adBottomMarkup}

      ${conclusionMarkup}
    </article>
  </main>

  <!-- フッターはcomponents.jsで動的に挿入されます -->

  <script src="${mainJsSrc}" defer></script>
  <script src="${articleJsSrc}" defer></script>
  <script src="${normalizedAssetBase}assets/js/components.js" defer></script>
</body>
</html>`;
  };

  return { compileArticleHtml };
};

module.exports = {
  createTemplateRenderer,
};
