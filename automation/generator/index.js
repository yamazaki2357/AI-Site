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
const { searchTopArticles } = require('../lib/googleSearch');

const root = path.resolve(__dirname, '..', '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const postsJsonPath = path.join(root, 'data', 'posts.json');
const topicHistoryPath = path.join(root, 'data', 'topic-history.json');

const API_URL = 'https://api.openai.com/v1/chat/completions';
const DEDUPE_WINDOW_DAYS = 5;

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

const computeReadingStats = (sections, summary) => {
  const rawText = [summary, ...sections.map((section) => section.body ?? '')]
    .join('\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ');
  const characters = rawText.replace(/\s+/g, '').length;
  const approxChars = Math.max(400, Math.round(((characters || 800) / 50)) * 50);
  const minutes = Math.max(3, Math.round(characters / 400) || 3);
  return { minutes, approxChars };
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

const compileArticleHtml = (article, meta, options = {}) => {
  const assetBase = typeof options.assetBase === 'string' ? options.assetBase : '../';
  const normalizedAssetBase = assetBase.endsWith('/') ? assetBase : `${assetBase}/`;
  const cssHref = `${normalizedAssetBase}assets/css/style.css`;
  const mainJsSrc = `${normalizedAssetBase}assets/js/main.js`;
  const articleJsSrc = `${normalizedAssetBase}assets/js/article.js`;
  const homeHref = `${normalizedAssetBase}index.html`;

  const sections = Array.isArray(article.sections) ? article.sections : [];
  const references = Array.isArray(article.references) ? article.references : [];
  const seoInsights = Array.isArray(article.seoInsights) ? article.seoInsights : [];
  const tags = Array.isArray(article.tags) ? article.tags : [];

  const dateParts = formatDateParts(meta.date);
  const reading = computeReadingStats(sections, article.summary ?? '');
  const approxCharsLabel = reading.approxChars.toLocaleString('ja-JP');
  const sourceName = meta.sourceName || '情報ソース';
  const sourceLinkHref = meta.sourceUrl || meta.videoUrl || homeHref;
  const sourceLinkLabel = meta.sourceUrl
    ? 'チャンネルを見る'
    : meta.videoUrl
      ? '元動画を見る'
      : '記事一覧へ戻る';

  const heroButtonHref = meta.videoUrl || meta.sourceUrl || homeHref;
  const heroButtonLabel = meta.videoUrl ? '元動画を見る' : '記事一覧へ戻る';
  const heroButtonAttrs = /^https?:/i.test(heroButtonHref)
    ? ' target="_blank" rel="noopener noreferrer"'
    : '';
  const sourceLinkAttrs = /^https?:/i.test(sourceLinkHref)
    ? ' target="_blank" rel="noopener noreferrer"'
    : '';

  const noteText = meta.sourceName
    ? `${meta.sourceName}の最新コンテンツをもとに、${dateParts.verbose || meta.date}時点のインサイトを整理しました。`
    : '自動収集した候補をもとにAIがまとめたドラフト記事です。';

  const sectionMarkup = sections
    .map((section, index) => {
      const heading = section.heading ?? `セクション${index + 1}`;
      const slug = slugifyHeading(heading, index);
      const eyebrow = `Section ${String(index + 1).padStart(2, '0')}`;
      const bulletList = Array.isArray(section.points)
        ? section.points
        : Array.isArray(section.bullets)
          ? section.bullets
          : [];
      const bulletMarkup = bulletList.length
        ? `
              <ul>
                ${bulletList.map((item) => `<li>${item}</li>`).join('\n                ')}
              </ul>`
        : '';

      return `
            <section class="article-section" id="${slug}">
              <p class="section-eyebrow">${eyebrow}</p>
              <h2>${heading}</h2>
              ${toHtmlParagraphs(section.body)}
              ${bulletMarkup}
            </section>`;
    })
    .join('\n');

  const referenceMarkup = references.length
    ? references
        .map((ref, index) => {
          if (typeof ref === 'string') {
            return `<li><a href="${ref}" target="_blank" rel="noopener noreferrer">${ref}</a></li>`;
          }
          if (ref && typeof ref === 'object') {
            const label = ref.title || `参考リンク${index + 1}`;
            return `<li><a href="${ref.url}" target="_blank" rel="noopener noreferrer">${label}</a></li>`;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n            ')
    : '<li>参考リンクがありません</li>';

  const seoMarkup = seoInsights.length
    ? seoInsights.map((insight) => `<li>${insight}</li>`).join('\n            ')
    : '<li>SEO観点のメモはありません</li>';

  const tagMarkup = tags.length
    ? `<ul class="article-tags">
          ${tags.map((tag) => `<li>${tag}</li>`).join('\n          ')}
        </ul>`
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
  <meta property="og:image" content="${normalizedAssetBase}assets/img/logo.svg">
  <meta property="og:site_name" content="AI情報ブログ">
  <meta property="og:locale" content="ja_JP">
  <meta property="article:published_time" content="${dateParts.dotted}T00:00:00+09:00">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${article.title} | AI情報ブログ">
  <meta name="twitter:description" content="${article.summary ?? ''}">
  <meta name="twitter:image" content="${normalizedAssetBase}assets/img/logo.svg">

  <link rel="stylesheet" href="${cssHref}">
</head>
<body class="article-page">
  <!-- ヘッダーはcomponents.jsで動的に挿入されます -->

  <main>
    <article class="article-detail">
      <section class="inner article-hero">
        <p class="article-eyebrow">Daily Briefing</p>
        <div class="article-hero-main">
          <div>
            <p class="post-meta">${dateParts.dotted}</p>
            <h1>${article.title}</h1>
            <p class="article-summary">${article.summary ?? ''}</p>
          </div>
          <div class="article-hero-cta">
            <a class="button button-primary" href="${heroButtonHref}"${heroButtonAttrs}>${heroButtonLabel}</a>
            <button class="button button-ghost" type="button" data-share-target="native">この記事を共有</button>
          </div>
        </div>

        <div class="article-meta-grid">
          <article class="meta-card">
            <p class="meta-label">公開日</p>
            <p class="meta-value">${dateParts.verbose || meta.date}</p>
            <small>最終更新: ${dateParts.dotted}</small>
          </article>
          <article class="meta-card">
            <p class="meta-label">推定読了時間</p>
            <p class="meta-value">${reading.minutes}分</p>
            <small>約${approxCharsLabel}文字</small>
          </article>
          <article class="meta-card">
            <p class="meta-label">リサーチソース</p>
            <p class="meta-value">${sourceName}</p>
            <a href="${sourceLinkHref}"${sourceLinkAttrs}>${sourceLinkLabel}</a>
          </article>
        </div>

        ${tagMarkup}

        <div class="article-share-links">
          <a class="share-link" href="#" data-share-target="x" aria-label="Xで共有">Xで共有</a>
          <a class="share-link" href="#" data-share-target="linkedin" aria-label="LinkedInで共有">LinkedIn</a>
          <button class="share-link copy-link" type="button" data-copy-link>リンクをコピー</button>
        </div>
      </section>

      <div class="inner article-grid">
        <div class="article-main-column">
          <article class="post-article article-content">
${sectionMarkup}
          </article>
        </div>

        <aside class="article-sidebar" aria-label="補足情報">
          <section class="article-card article-toc">
            <p class="article-card-label">目次</p>
            <ol class="toc-list" data-toc-list aria-live="polite"></ol>
          </section>
          <section class="article-card article-note">
            <p class="article-card-label">補足メモ</p>
            <p class="article-note-text">${noteText}</p>
          </section>
        </aside>
      </div>

      <section class="inner article-panels">
        <article class="article-panel seo-panel">
          <p class="panel-label">SEO観点</p>
          <h2>検索上位との差別化ポイント</h2>
          <ul class="insight-list">
            ${seoMarkup}
          </ul>
        </article>

        <article class="article-panel reference-panel">
          <p class="panel-label">参考リンク</p>
          <ul class="reference-list">
            ${referenceMarkup}
          </ul>
        </article>
      </section>
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

const formatSearchResults = (results) => {
  if (!Array.isArray(results) || results.length === 0) {
    return '（検索結果なし）';
  }
  return results
    .map(
      (item, index) =>
        `${index + 1}. ${item.title} (${item.link}) - ${item.snippet ?? 'No snippet'}`,
    )
    .join('\n');
};

const requestArticleDraft = async (apiKey, candidate, searchResults) => {
  const today = new Date().toISOString().split('T')[0];
  const focusText = (candidate.source.focus || []).join(' / ');
  const searchSummary = formatSearchResults(searchResults);
  const sourceUrl = resolveSourceUrl(candidate.source);
  const promptSourceUrl = sourceUrl || 'URL不明';
  const payload = {
    model: 'gpt-4o',
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are an SEO-focused AI editor. Always respond with valid JSON. Keep tone factual, include concrete insights, and avoid speculation.',
      },
      {
        role: 'user',
        content: `
You are given metadata from a YouTube video. Generate a Japanese blog draft that balances summary and SEO insights.
Video Title: ${candidate.video.title}
Video URL: ${candidate.video.url}
Published At: ${candidate.video.publishedAt}
Channel: ${candidate.source.name} (${promptSourceUrl})
Channel Focus: ${focusText}
Video Description:
${candidate.video.description}

Top search results related to the topic:
${searchSummary}

Requirements:
- Provide title (<=30 characters), summary (<=2 sentences), tags (2-4 entries).
- sections: 3 sections with heading/body paragraphs referencing the video.
- references: 2-3 external links (URL strings or {title,url} objects) relevant to the topic.
- seoInsights: 3 bullet points describing how top-ranking articles might structure the topic, differentiation ideas, or keywords worth covering.
- Keep JSON keys: title, summary, tags, sections, references, seoInsights.
- Consider current trends as of ${today} when suggesting SEO insights.
`,
      },
    ],
  };

  const response = await fetch(API_URL, {
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
  const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const googleCx = process.env.GOOGLE_SEARCH_CX;

  const candidates = readJson(candidatesPath, []);
  const posts = readJson(postsJsonPath, []);
  const topicHistory = readJson(topicHistoryPath, []);

  const candidate = candidates.find((item) => item.status === 'pending');
  if (!candidate) {
    console.log('[generator] pending状態の候補が存在しないため処理を終了します。');
    return {
      generated: false,
      reason: 'no-pending-candidates',
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

  let searchResults = [];
  if (googleApiKey && googleCx) {
    try {
      const query = `${candidate.video.title} ${candidate.source.focus?.[0] ?? ''}`.trim();
      console.log(`[generator] Google検索を実行: "${query}"`);
      const res = await searchTopArticles({
        apiKey: googleApiKey,
        cx: googleCx,
        query,
        num: 3,
      });
      searchResults = Array.isArray(res.items) ? res.items : [];
      console.log(`[generator] Google検索結果: ${searchResults.length}件`);
    } catch (error) {
      console.warn('Google Search API 呼び出しでエラー:', error.message);
    }
  } else {
    console.log('[generator] Google検索キーが設定されていないため検索ステップをスキップします。');
  }

  const article = await requestArticleDraft(apiKey, candidate, searchResults);
  console.log(`[generator] OpenAI応答を受信: "${article.title}"`);

  const today = new Date().toISOString().split('T')[0];
  const slug = `${today}-${topicKey}`;
  const fileName = `${slug}.html`;
  const publishRelativePath = path.posix.join('posts', fileName);

  const meta = {
    date: today,
    sourceName: candidate.source.name,
    sourceUrl,
    videoUrl: candidate.video.url,
  };

  const publishHtml = compileArticleHtml(article, meta, { assetBase: '../' });

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
    title: article.title,
    date: today,
    summary: article.summary ?? '',
    tags: Array.isArray(article.tags) ? article.tags : [],
    url: publishRelativePath,
    slug,
  };

  const articleData = {
    title: article.title,
    summary: article.summary ?? '',
    tags: Array.isArray(article.tags) ? article.tags : [],
    sections: Array.isArray(article.sections) ? article.sections : [],
    references: Array.isArray(article.references) ? article.references : [],
    seoInsights: Array.isArray(article.seoInsights) ? article.seoInsights : [],
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
