#!/usr/bin/env node
/**
 * Generator
 * - Picks researched candidates from data/candidates.json
 * - Calls OpenAI to craft SEO-oriented article drafts
 * - Returns article HTML for publisher and records topic history for deduplication
 */

const path = require('path');
const { readJson, writeJson } = require('../lib/io');
const slugify = require('../lib/slugify');
const { GENERATOR } = require('../config/constants');
const { ARTICLE_GENERATION } = require('../config/models');
const PROMPTS = require('../config/prompts');
const { callOpenAI } = require('../lib/openai');
const { readCandidates, writeCandidates } = require('../lib/candidatesRepository');
const { createLogger } = require('../lib/logger');
const { createMetricsTracker } = require('../lib/metrics');
const { createTagMapper } = require('./services/tagMapper');
const { createImageSelector } = require('./services/imageSelector');
const { createTemplateRenderer } = require('./services/templateRenderer');

const root = path.resolve(__dirname, '..', '..');
const postsJsonPath = path.join(root, 'data', 'posts.json');
const topicHistoryPath = path.join(root, 'data', 'topic-history.json');
const tagsConfigPath = path.join(root, 'data', 'tags.json');
const articleImagesManifestPath = path.join(root, 'assets', 'img', 'articles', 'index.json');
const articleHtmlTemplatePath = path.join(root, 'automation', 'templates', 'article.html');

const { DEDUPE_WINDOW_DAYS } = GENERATOR;
const logger = createLogger('generator');
const metricsTracker = createMetricsTracker('generator');

const { mapArticleTags } = createTagMapper({
  readJson,
  tagsConfigPath,
});

const { selectArticleImage } = createImageSelector({
  readJson,
  manifestPath: articleImagesManifestPath,
});

const { compileArticleHtml } = createTemplateRenderer({
  templatePath: articleHtmlTemplatePath,
});

const createChannelUrl = (channelId) =>
  channelId ? `https://www.youtube.com/channel/${channelId}` : '';

const resolveSourceUrl = (source) => {
  if (!source) return '';
  return source.url || createChannelUrl(source.channelId);
};

// テンプレート関連のユーティリティは templateRenderer サービスに移動

// タグ辞書と画像選定ロジックは services 配下へ移動済み

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

  const messages = [
    {
      role: 'system',
      content: PROMPTS.ARTICLE_GENERATION.system,
    },
    {
      role: 'user',
      content: PROMPTS.ARTICLE_GENERATION.user(candidate, searchSummary, searchQuery, today),
    },
  ];

  const completion = await callOpenAI({
    apiKey,
    messages,
    model: ARTICLE_GENERATION.model,
    temperature: ARTICLE_GENERATION.temperature,
    responseFormat: ARTICLE_GENERATION.response_format,
  });

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
  logger.info('ステージ開始: 候補の分析を実行します。');
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY が設定されていません。GitHub Secrets に登録してください。');
  }

  const candidates = readCandidates();
  metricsTracker.set('candidates.total', candidates.length);
  const buildResult = (payload) => {
    const summary = metricsTracker.summary();
    logger.info('Generatorメトリクスサマリー:', summary);
    return {
      ...payload,
      metrics: summary,
    };
  };
  const posts = readJson(postsJsonPath, []);
  const topicHistory = readJson(topicHistoryPath, []);

  const candidate = candidates.find((item) => item.status === 'researched');
  if (!candidate) {
    logger.info('researched状態の候補が存在しないため処理を終了します。');
    return buildResult({
      generated: false,
      reason: 'no-researched-candidates',
    });
  }

  metricsTracker.increment('candidates.analyzed');
  logger.info(
    `対象候補: ${candidate.id} / ${candidate.source.name} / ${candidate.video?.title}`,
  );
  const sourceUrl = resolveSourceUrl(candidate.source);
  const fallbackTopicKey = slugify(candidate.video?.title);
  const topicKey = candidate.topicKey || fallbackTopicKey;
  if (candidate.topicKey) {
    logger.info(`トピックキー: ${topicKey}`);
  } else {
    logger.warn(`⚠️ topicKey未設定のため動画タイトルから生成しました: ${topicKey}`);
  }
  const duplicate = isDuplicateTopic(topicKey, posts, topicHistory);
  logger.info(`重複判定: ${duplicate ? '重複あり → スキップ' : '新規トピック'}`);

  if (duplicate) {
    metricsTracker.increment('candidates.skipped.duplicate');
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
    writeCandidates(updatedCandidates);
    return buildResult({
      generated: false,
      reason: 'duplicate-topic',
      candidateId: candidate.id,
    });
  }

  const searchSummaries = Array.isArray(candidate.searchSummaries)
    ? candidate.searchSummaries
    : [];
  if (searchSummaries.length === 0) {
    logger.warn(
      '⚠️ Google検索の上位記事要約がありませんが、動画情報のみで記事生成を試みます。',
    );
  }

  const enrichedCandidate = {
    ...candidate,
    searchSummaries,
  };

  let article;
  const stopDraftTimer = metricsTracker.startTimer('articleGeneration.timeMs');
  try {
    article = await requestArticleDraft(apiKey, enrichedCandidate);
    const elapsed = stopDraftTimer();
    metricsTracker.increment('articles.generated');
    logger.info(`OpenAI応答を受信: "${article.title}" (${elapsed}ms)`);
  } catch (error) {
    const elapsed = stopDraftTimer();
    metricsTracker.increment('articles.failed');
    logger.error(`⚠️ 記事生成に失敗しました: ${error.message} (${elapsed}ms)`);
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
    writeCandidates(updatedCandidates);
    return buildResult({
      generated: false,
      reason: 'article-generation-failed',
      candidateId: candidate.id,
      error: error.message,
    });
  }

  const normalizedTags = mapArticleTags(article.tags);
  const hydratedArticle = {
    ...article,
    tags: normalizedTags,
  };
  const selectedImage = selectArticleImage(hydratedArticle, candidate);

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
    videoTitle: candidate.video.title,
    image: selectedImage,
  };

  const publishHtml = compileArticleHtml(hydratedArticle, meta, {
    assetBase: '../',
    image: selectedImage,
  });

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
          image: selectedImage || null,
          imageKey: selectedImage?.key || null,
        }
      : item,
  );
  writeCandidates(updatedCandidates);

  const updatedHistory = updateTopicHistory(topicHistory, topicKey, {
    sourceName: candidate.source.name,
    videoTitle: candidate.video.title,
    draftUrl: publishRelativePath,
    lastPublishedAt: today,
  });
  writeJson(topicHistoryPath, updatedHistory);
  logger.info('candidates と topic-history を更新しました。');

  const postEntry = {
    title: hydratedArticle.title,
    date: today,
    summary: hydratedArticle.summary ?? '',
    tags: normalizedTags,
    url: publishRelativePath,
    slug,
    publishedAt: now,
    image: selectedImage || null,
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
    image: selectedImage || null,
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

  logger.info(`記事データを返却: slug=${slug}, ファイル予定パス=${publishRelativePath}`);

  return buildResult({
    generated: true,
    candidateId: candidate.id,
    postEntry,
    draftUrl: publishRelativePath,
    topicKey,
    article: articleData,
  });
};

if (require.main === module) {
  runGenerator()
    .then((result) => {
      logger.info('Generator finished:', result);
    })
    .catch((error) => {
      logger.error('Generator failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runGenerator,
};
