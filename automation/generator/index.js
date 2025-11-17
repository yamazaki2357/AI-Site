#!/usr/bin/env node
/**
 * Generator
 * - Picks pending candidates from data/candidates.json
 * - Calls OpenAI to research SEO-oriented article outline
 * - Returns article HTML for publisher and records topic history for deduplication
 */

const path = require('path');
const { readJson, writeJson } = require('../lib/io');
const slugify = require('../lib/slugify');
const { GENERATOR } = require('../config/constants');
const { OPENAI_API_URL, ARTICLE_GENERATION } = require('../config/models');
const PROMPTS = require('../config/prompts');

const root = path.resolve(__dirname, '..', '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const postsJsonPath = path.join(root, 'data', 'posts.json');
const topicHistoryPath = path.join(root, 'data', 'topic-history.json');
const tagsConfigPath = path.join(root, 'data', 'tags.json');

const { DEDUPE_WINDOW_DAYS } = GENERATOR;

const createChannelUrl = (channelId) =>
  channelId ? `https://www.youtube.com/channel/${channelId}` : '';

const resolveSourceUrl = (source) => {
  if (!source) return '';
  return source.url || createChannelUrl(source.channelId);
};

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

const normalizeTagToken = (value) => {
  if (value === null || value === undefined) return '';
  return value
    .toString()
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
};

const buildTagDictionary = () => {
  const raw = readJson(tagsConfigPath, []);
  const entries = Array.isArray(raw) ? raw : [];
  const index = new Map();

  const registerToken = (token, entry) => {
    if (!token || index.has(token)) return;
    index.set(token, entry);
  };

  entries.forEach((item) => {
    if (!item || !item.slug) return;
    const normalizedEntry = {
      slug: item.slug,
      label: item.label || item.slug,
      category: item.category || 'その他',
      style: item.style || null,
    };
    registerToken(normalizeTagToken(item.slug), normalizedEntry);
    registerToken(normalizeTagToken(item.label), normalizedEntry);
    if (Array.isArray(item.aliases)) {
      item.aliases.forEach((alias) => registerToken(normalizeTagToken(alias), normalizedEntry));
    }
  });

  return { entries, index };
};

const tagDictionary = buildTagDictionary();

const mapArticleTags = (rawTags) => {
  if (!Array.isArray(rawTags) || rawTags.length === 0) return [];
  const seen = new Set();
  const tags = [];

  rawTags.forEach((tag, idx) => {
    const token = normalizeTagToken(tag);
    if (!token) return;

    const matched = tagDictionary.index.get(token);
    if (matched) {
      if (seen.has(matched.slug)) return;
      seen.add(matched.slug);
      tags.push({
        slug: matched.slug,
        label: matched.label || matched.slug,
        category: matched.category || 'その他',
        style: matched.style || null,
      });
      return;
    }

    const fallbackBase = slugify(tag, 'tag');
    const fallbackSlug =
      seen.has(fallbackBase) || fallbackBase === 'tag'
        ? `${fallbackBase}-${idx + 1}`
        : fallbackBase;
    if (seen.has(fallbackSlug)) return;
    seen.add(fallbackSlug);
    const fallbackLabel = (tag ?? '').toString().trim() || `タグ${idx + 1}`;
    tags.push({
      slug: fallbackSlug,
      label: fallbackLabel,
      category: 'その他',
      style: 'accent-neutral',
    });
  });

  return tags;
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
        const categoryAttr = tagItem.category ? ` data-tag-category="${tagItem.category}"` : '';
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
      return `
            <section class="article-section" id="${slug}">
              <h2 class="section-heading">${heading}</h2>
              ${overviewMarkup}
              ${subSections}
            </section>`;
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

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${article.title} | AI情報ブログ</title>
  <meta name="description" content="${article.summary ?? ''}">

  <!-- ファビコン -->
  <link rel="icon" type="image/svg+xml" href="${normalizedAssetBase}assets/img/logo.svg">
  <link rel="apple-touch-icon" href="${normalizedAssetBase}assets/img/logo.svg">

  <!-- Open Graph / SNS共有 -->
  <meta property="og:type" content="article">
  <meta property="og:title" content="${article.title} | AI情報ブログ">
  <meta property="og:description" content="${article.summary ?? ''}">
  <meta property="og:image" content="${normalizedAssetBase}assets/img/ogp-default.svg">
  <meta property="og:site_name" content="AI情報ブログ">
  <meta property="og:locale" content="ja_JP">
  <meta property="article:published_time" content="${dateParts.dotted}T00:00:00+09:00">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${article.title} | AI情報ブログ">
  <meta name="twitter:description" content="${article.summary ?? ''}">
  <meta name="twitter:image" content="${normalizedAssetBase}assets/img/ogp-default.svg">

  <link rel="stylesheet" href="${cssHref}">
</head>
<body class="article-page">
  <!-- ヘッダーはcomponents.jsで動的に挿入されます -->

  <main>
    <article class="article-detail">
      <section class="inner article-hero">
        <p class="article-eyebrow">Daily Briefing</p>
        <div class="article-hero-main">
          <p class="post-meta">${dateParts.dotted || meta.date}</p>
          <h1>${article.title}</h1>
          <p class="article-summary">${article.summary ?? ''}</p>
        </div>

        ${tagMarkup}
      </section>

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

      ${conclusionMarkup}
    </article>
  </main>

  <!-- フッターはcomponents.jsで動的に挿入されます -->

  <script src="${normalizedAssetBase}assets/js/components.js"></script>
  <script src="${mainJsSrc}" defer></script>
  <script src="${articleJsSrc}" defer></script>
</body>
</html>`;
};

const parseCompletionContent = (content) => {
  if (!content) {
    throw new Error('OpenAIレスポンスにcontentが含まれていません');
  }
  if (typeof content === 'string') {
    return JSON.parse(content);
  }
  if (Array.isArray(content)) {
    const merged = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('')
      .trim();
    return JSON.parse(merged);
  }
  throw new Error('contentの形式を解析できませんでした');
};

const extractSearchQuery = (candidate) => {
  // 新しい構造: { original, extracted, method }
  if (candidate.searchQuery && typeof candidate.searchQuery === 'object') {
    return candidate.searchQuery.extracted || candidate.searchQuery.original || '';
  }
  // 旧構造: 文字列
  if (typeof candidate.searchQuery === 'string') {
    return candidate.searchQuery;
  }
  // フォールバック
  return candidate.video?.title || '';
};

const formatSearchSummaries = (summaries) => {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return '検索要約が取得できていません。';
  }
  return summaries
    .map((item, index) => {
      const title = item.title || `Source ${index + 1}`;
      const url = item.url || 'URLなし';
      const summary = item.summary || item.snippet || '要約なし';
      const snippet = item.snippet ? `\nスニペット: ${item.snippet}` : '';
      return `### ソース${index + 1}\nタイトル: ${title}\nURL: ${url}\n要約: ${summary}${snippet}`;
    })
    .join('\n\n');
};

const requestArticleDraft = async (apiKey, candidate) => {
  const today = new Date().toISOString().split('T')[0];
  const searchSummary = formatSearchSummaries(candidate.searchSummaries);
  const searchQuery = extractSearchQuery(candidate);

  const payload = {
    model: ARTICLE_GENERATION.model,
    temperature: ARTICLE_GENERATION.temperature,
    response_format: ARTICLE_GENERATION.response_format,
    messages: [
      {
        role: 'system',
        content: PROMPTS.ARTICLE_GENERATION.system,
      },
      {
        role: 'user',
        content: PROMPTS.ARTICLE_GENERATION.user(candidate, searchSummary, searchQuery, today),
      },
    ],
  };

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  const completion = await response.json();
  const content = completion?.choices?.[0]?.message?.content;
  return parseCompletionContent(content);
};

const isDuplicateTopic = (topicKey, posts, history) => {
  const now = Date.now();
  const windowMs = DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = now - windowMs;

  const inPosts = posts.some((post) => slugify(post.title) === topicKey);
  if (inPosts) return true;

  return history.some((entry) => {
    if (entry.topicKey !== topicKey) return false;
    const last = new Date(entry.lastPublishedAt || entry.firstSeen).getTime();
    return !Number.isNaN(last) && last >= cutoff;
  });
};

const updateTopicHistory = (history, topicKey, record) => {
  const filtered = history.filter((entry) => entry.topicKey !== topicKey);
  const now = new Date().toISOString();
  filtered.push({
    topicKey,
    firstSeen: record.firstSeen || now,
    lastPublishedAt: record.lastPublishedAt || now,
    sourceName: record.sourceName,
    videoTitle: record.videoTitle,
    draftUrl: record.draftUrl,
  });
  return filtered;
};

const runGenerator = async () => {
  console.log('[generator] ステージ開始: 候補の分析を実行します。');
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY が設定されていません。GitHub Secrets に登録してください。');
  }

  const candidates = readJson(candidatesPath, []);
  const posts = readJson(postsJsonPath, []);
  const topicHistory = readJson(topicHistoryPath, []);

  const candidate = candidates.find((item) => item.status === 'researched');
  if (!candidate) {
    console.log('[generator] researched状態の候補が存在しないため処理を終了します。');
    return {
      generated: false,
      reason: 'no-researched-candidates',
    };
  }

  console.log(
    `[generator] 対象候補: ${candidate.id} / ${candidate.source.name} / ${candidate.video?.title}`,
  );
  const sourceUrl = resolveSourceUrl(candidate.source);
  const topicKey = candidate.topicKey || slugify(candidate.video?.title);
  const duplicate = isDuplicateTopic(topicKey, posts, topicHistory);
  console.log(`[generator] 重複判定: ${duplicate ? '重複あり → スキップ' : '新規トピック'}`);

  if (duplicate) {
    const now = new Date().toISOString();
    const updatedCandidates = candidates.map((item) =>
      item.id === candidate.id
        ? {
            ...item,
            status: 'skipped',
            skipReason: 'duplicate-topic',
            updatedAt: now,
          }
        : item,
    );
    writeJson(candidatesPath, updatedCandidates);
    return {
      generated: false,
      reason: 'duplicate-topic',
      candidateId: candidate.id,
    };
  }

  const searchSummaries = Array.isArray(candidate.searchSummaries)
    ? candidate.searchSummaries
    : [];
  if (searchSummaries.length === 0) {
    console.log(
      '[generator] ⚠️ Google検索の上位記事要約がありませんが、動画情報のみで記事生成を試みます。',
    );
  }

  const enrichedCandidate = {
    ...candidate,
    searchSummaries,
  };

  let article;
  try {
    article = await requestArticleDraft(apiKey, enrichedCandidate);
    console.log(`[generator] OpenAI応答を受信: "${article.title}"`);
  } catch (error) {
    console.error(`[generator] ⚠️ 記事生成に失敗しました: ${error.message}`);
    const now = new Date().toISOString();
    const updatedCandidates = candidates.map((item) =>
      item.id === candidate.id
        ? {
            ...item,
            status: 'failed',
            failReason: 'article-generation-error',
            errorMessage: error.message,
            updatedAt: now,
          }
        : item,
    );
    writeJson(candidatesPath, updatedCandidates);
    return {
      generated: false,
      reason: 'article-generation-failed',
      candidateId: candidate.id,
      error: error.message,
    };
  }

  const normalizedTags = mapArticleTags(article.tags);
  const hydratedArticle = {
    ...article,
    tags: normalizedTags,
  };

  const today = new Date().toISOString().split('T')[0];
  const slugifiedTitle = slugify(article.title, topicKey || 'ai-topic');
  const slug = `${today}-${slugifiedTitle}`;
  const fileName = `${slug}.html`;
  const publishRelativePath = path.posix.join('posts', fileName);

  const meta = {
    date: today,
    sourceName: candidate.source.name,
    sourceUrl,
    videoUrl: candidate.video.url,
  };

  const publishHtml = compileArticleHtml(hydratedArticle, meta, { assetBase: '../' });

  const now = new Date().toISOString();

  const updatedCandidates = candidates.map((item) =>
    item.id === candidate.id
      ? {
          ...item,
          status: 'generated',
          generatedAt: now,
          updatedAt: now,
          topicKey,
          postDate: today,
          slug,
          outputFile: publishRelativePath,
        }
      : item,
  );
  writeJson(candidatesPath, updatedCandidates);

  const updatedHistory = updateTopicHistory(topicHistory, topicKey, {
    sourceName: candidate.source.name,
    videoTitle: candidate.video.title,
    draftUrl: publishRelativePath,
    lastPublishedAt: today,
  });
  writeJson(topicHistoryPath, updatedHistory);
  console.log('[generator] candidates と topic-history を更新しました。');

  const postEntry = {
    title: hydratedArticle.title,
    date: today,
    summary: hydratedArticle.summary ?? '',
    tags: normalizedTags,
    url: publishRelativePath,
    slug,
  };

  const articleData = {
    title: hydratedArticle.title,
    summary: hydratedArticle.summary ?? '',
    intro: hydratedArticle.intro ?? '',
    conclusion: hydratedArticle.conclusion ?? '',
    tags: normalizedTags,
    sections: Array.isArray(hydratedArticle.sections) ? hydratedArticle.sections : [],
    slug,
    date: today,
    htmlContent: publishHtml,
    relativePath: publishRelativePath,
    source: {
      name: candidate.source.name,
      url: sourceUrl,
    },
    video: {
      title: candidate.video.title,
      url: candidate.video.url,
    },
    searchSummaries,
  };

  console.log(
    `[generator] 記事データを返却: slug=${slug}, ファイル予定パス=${publishRelativePath}`,
  );

  return {
    generated: true,
    candidateId: candidate.id,
    postEntry,
    draftUrl: publishRelativePath,
    topicKey,
    article: articleData,
  };
};

if (require.main === module) {
  runGenerator()
    .then((result) => {
      console.log('Generator finished:', result);
    })
    .catch((error) => {
      console.error('Generator failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runGenerator,
};
