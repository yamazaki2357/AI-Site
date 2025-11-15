#!/usr/bin/env node
/**
 * Generator
 * - Picks pending candidates from data/candidates.json
 * - Calls OpenAI to research SEO-oriented article outline
 * - Writes draft HTML and records topic history for deduplication
 */

const path = require('path');
const fs = require('fs');
const { readJson, writeJson, ensureDir } = require('../lib/io');
const slugify = require('../lib/slugify');
const { searchTopArticles } = require('../lib/googleSearch');

const root = path.resolve(__dirname, '..', '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const postsJsonPath = path.join(root, 'data', 'posts.json');
const draftsDir = path.join(root, 'posts', 'generated-drafts');
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

const compileArticleHtml = (article, meta, options = {}) => {
  const assetBase = typeof options.assetBase === 'string' ? options.assetBase : '../';
  const normalizedAssetBase = assetBase.endsWith('/') ? assetBase : `${assetBase}/`;
  const cssHref = `${normalizedAssetBase}assets/css/style.css`;
  const homeHref = `${normalizedAssetBase}index.html`;
  const sections = Array.isArray(article.sections) ? article.sections : [];
  const references = Array.isArray(article.references) ? article.references : [];
  const seoInsights = Array.isArray(article.seoInsights) ? article.seoInsights : [];

  const sectionMarkup = sections
    .map(
      (section) => `
    <section>
      <h2>${section.heading ?? ''}</h2>
      ${toHtmlParagraphs(section.body)}
    </section>`,
    )
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
        .join('\n        ')
    : '<li>参考リンクがありません</li>';

  const seoMarkup = seoInsights.length
    ? seoInsights
        .map((insight) => `<li>${insight}</li>`)
        .join('\n        ')
    : '<li>SEO観点のメモはありません</li>';

  const tags = Array.isArray(article.tags) ? article.tags.join(', ') : '';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${article.title} | AI情報ブログ</title>
  <link rel="stylesheet" href="${cssHref}">
</head>
<body>
  <header>
    <nav>
      <a href="${homeHref}">ホームに戻る</a>
    </nav>
  </header>

  <article>
    <header>
      <p class="post-meta">公開日: ${meta.date}</p>
      <h1>${article.title}</h1>
      <p class="post-summary">${article.summary ?? ''}</p>
      <p class="post-meta">元ネタ: ${meta.sourceName} / <a href="${meta.sourceUrl}" target="_blank" rel="noopener noreferrer">${meta.videoUrl}</a></p>
      <p class="post-meta">タグ: ${tags}</p>
    </header>
    <section>
      <h2>SEO観点の調査メモ</h2>
      <ul>
        ${seoMarkup}
      </ul>
    </section>
    ${sectionMarkup}
    <footer>
      <h2>参考リンク</h2>
      <ul>
        ${referenceMarkup}
      </ul>
    </footer>
  </article>

  <footer>
    <small>&copy; ${new Date(meta.date).getFullYear()} AI情報ブログ</small>
  </footer>
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

  ensureDir(draftsDir);

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
  const draftPath = path.join(draftsDir, fileName);
  const draftRelativePath = path.posix.join('posts', 'generated-drafts', fileName);
  const publishRelativePath = path.posix.join('posts', fileName);

  const meta = {
    date: today,
    sourceName: candidate.source.name,
    sourceUrl,
    videoUrl: candidate.video.url,
  };

  const publishHtml = compileArticleHtml(article, meta, { assetBase: '../' });
  const draftHtml = compileArticleHtml(article, meta, { assetBase: '../../' });
  fs.writeFileSync(draftPath, draftHtml);
  console.log(`[generator] ドラフトHTMLを保存: ${draftRelativePath}`);

  const now = new Date().toISOString();

  const updatedCandidates = candidates.map((item) =>
    item.id === candidate.id
      ? {
          ...item,
          status: 'generated',
          generatedAt: now,
          updatedAt: now,
          topicKey,
          draftUrl: draftRelativePath,
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
    draftUrl: draftRelativePath,
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
    draftUrl: draftRelativePath,
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
