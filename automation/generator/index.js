#!/usr/bin/env node
/**
 * @fileoverview Generator: 記事生成ステージ
 * - `data/candidates.json` から `status='researched'` の候補を1つ選択します。
 * - OpenAI API を呼び出し、SEOを意識した記事の下書きをJSON形式で生成させます。
 * - 生成された記事データとテンプレートを組み合わせて、公開用のHTMLファイルを作成します。
 * - 記事のトピックが最近公開されたものと重複していないかチェックします。
 * - 候補のステータスを `generated` に更新し、次のPublisherステージに渡します。
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

// --- パス設定 ---
// プロジェクトのルートディレクトリを取得
const root = path.resolve(__dirname, '..', '..');
// 公開済み記事リストのパス
const postsJsonPath = path.join(root, 'data', 'posts.json');
// トピック履歴のパス
const topicHistoryPath = path.join(root, 'data', 'topic-history.json');
// タグ定義ファイルのパス
const tagsConfigPath = path.join(root, 'data', 'tags.json');
// 記事画像リストのパス
const articleImagesManifestPath = path.join(root, 'assets', 'img', 'articles', 'index.json');
// 記事HTMLテンプレートのパス
const articleHtmlTemplatePath = path.join(root, 'automation', 'templates', 'article.html');

// --- 定数 ---
const { DEDUPE_WINDOW_DAYS } = GENERATOR;
// ロガーとメトリクス追跡ツールを初期化
const logger = createLogger('generator');
const metricsTracker = createMetricsTracker('generator');

// --- サービス初期化 ---
// タグマッピングサービス: AIが生成したタグを正規化する
const { mapArticleTags } = createTagMapper({
  readJson,
  tagsConfigPath,
});

// 画像選択サービス: 記事内容に合った画像を自動で選ぶ
const { selectArticleImage } = createImageSelector({
  readJson,
  manifestPath: articleImagesManifestPath,
});

// テンプレートレンダリングサービス: 記事データからHTMLを生成する
const { compileArticleHtml } = createTemplateRenderer({
  templatePath: articleHtmlTemplatePath,
});

/**
 * チャンネルIDからYouTubeチャンネルURLを生成します。
 * @param {string} channelId - YouTubeチャンネルID
 * @returns {string} チャンネルURL
 */
const createChannelUrl = (channelId) =>
  channelId ? `https://www.youtube.com/channel/${channelId}` : '';

/**
 * 候補のソース情報からURLを解決します。
 * @param {object} source - 候補のソースオブジェクト
 * @returns {string} ソースのURL
 */
const resolveSourceUrl = (source) => {
  if (!source) return '';
  // source.urlが存在すればそれを使い、なければチャンネルIDから生成
  return source.url || createChannelUrl(source.channelId);
};

/**
 * OpenAIからのレスポンス（JSON文字列）をパースします。
 * @param {string|Array} content - OpenAIの`message.content`
 * @returns {object} パースされたJSONオブジェクト
 * @throws {Error} パースに失敗した場合
 */
const parseCompletionContent = (content) => {
  if (!content) {
    throw new Error('OpenAIレスポンスにcontentが含まれていません');
  }
  // contentが文字列の場合、そのままパース
  if (typeof content === 'string') {
    return JSON.parse(content);
  }
  // ストリーミングなどでcontentが配列の場合を考慮
  if (Array.isArray(content)) {
    // 配列の各要素を結合して1つのJSON文字列にする
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

/**
 * 候補データから検索クエリを抽出します。
 * @param {object} candidate - 候補オブジェクト
 * @returns {string} 検索クエリ
 */
const extractSearchQuery = (candidate) => {
  // 新しい構造: { original, extracted, method }
  if (candidate.searchQuery && typeof candidate.searchQuery === 'object') {
    return candidate.searchQuery.extracted || candidate.searchQuery.original || '';
  }
  // 古い構造: 文字列
  if (typeof candidate.searchQuery === 'string') {
    return candidate.searchQuery;
  }
  // フォールバックとして動画タイトルを使用
  return candidate.video?.title || '';
};

/**
 * Google検索の要約結果を整形してプロンプトに含める文字列を生成します。
 * @param {Array<object>} summaries - 要約情報の配列
 * @returns {string} 整形された文字列
 */
const formatSearchSummaries = (summaries) => {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return '検索要約が取得できていません。';
  }
  // 各要約をマークダウン形式の文字列に変換
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

/**
 * OpenAI APIにリクエストを送り、記事の下書きを生成します。
 * @param {string} apiKey - OpenAI APIキー
 * @param {object} candidate - 記事の元となる候補データ
 * @returns {Promise<object>} 生成された記事データ (JSON)
 */
const requestArticleDraft = async (apiKey, candidate) => {
  const today = new Date().toISOString().split('T')[0];
  const searchSummary = formatSearchSummaries(candidate.searchSummaries);
  const searchQuery = extractSearchQuery(candidate);

  // プロンプトを組み立てる
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

  // OpenAI APIを呼び出す
  const completion = await callOpenAI({
    apiKey,
    messages,
    model: ARTICLE_GENERATION.model,
    temperature: ARTICLE_GENERATION.temperature,
    responseFormat: ARTICLE_GENERATION.response_format,
  });

  const content = completion?.choices?.[0]?.message?.content;
  // レスポンスをパースして返す
  return parseCompletionContent(content);
};

/**
 * 指定されたトピックキーが最近公開された記事と重複していないかチェックします。
 * @param {string} topicKey - チェックするトピックキー
 * @param {Array<object>} posts - 公開済み記事のリスト
 * @param {Array<object>} history - トピック履歴
 * @returns {boolean} 重複していればtrue
 */
const isDuplicateTopic = (topicKey, posts, history) => {
  const now = Date.now();
  // 重複チェック期間を計算
  const windowMs = DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = now - windowMs;

  // 1. 公開済み記事リストに同じトピックキーがないか確認
  const inPosts = posts.some((post) => slugify(post.title) === topicKey);
  if (inPosts) return true;

  // 2. トピック履歴内で、指定期間内に同じトピックキーが公開されていないか確認
  return history.some((entry) => {
    if (entry.topicKey !== topicKey) return false;
    const last = new Date(entry.lastPublishedAt || entry.firstSeen).getTime();
    // 最終公開日時がチェック期間内であれば重複とみなす
    return !Number.isNaN(last) && last >= cutoff;
  });
};

/**
 * トピック履歴を更新します。
 * @param {Array<object>} history - 現在のトピック履歴
 * @param {string} topicKey - 更新するトピックキー
 * @param {object} record - 関連情報
 * @returns {Array<object>} 更新されたトピック履歴
 */
const updateTopicHistory = (history, topicKey, record) => {
  // 既存の履歴から同じトピックキーのエントリを削除
  const filtered = history.filter((entry) => entry.topicKey !== topicKey);
  const now = new Date().toISOString();
  // 新しいエントリを追加
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

/**
 * Generatorステージのメイン処理
 */
const runGenerator = async () => {
  logger.info('ステージ開始: 候補の分析を実行します。');
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY が設定されていません。GitHub Secrets に登録してください。');
  }

  const candidates = readCandidates();
  metricsTracker.set('candidates.total', candidates.length);
  // 処理結果を返すためのヘルパー関数
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

  // `status='researched'` の候補を1つ見つける
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
  // トピックキーが存在しない場合のフォールバック
  const fallbackTopicKey = slugify(candidate.video?.title);
  const topicKey = candidate.topicKey || fallbackTopicKey;
  if (candidate.topicKey) {
    logger.info(`トピックキー: ${topicKey}`);
  } else {
    logger.warn(`⚠️ topicKey未設定のため動画タイトルから生成しました: ${topicKey}`);
  }

  // --- トピックの重複チェック ---
  const duplicate = isDuplicateTopic(topicKey, posts, topicHistory);
  logger.info(`重複判定: ${duplicate ? '重複あり → スキップ' : '新規トピック'}`);

  if (duplicate) {
    metricsTracker.increment('candidates.skipped.duplicate');
    const now = new Date().toISOString();
    // 候補のステータスを 'skipped' に更新
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

  // --- 記事生成 ---
  let article;
  const stopDraftTimer = metricsTracker.startTimer('articleGeneration.timeMs');
  try {
    // OpenAI APIを呼び出して記事を生成
    article = await requestArticleDraft(apiKey, enrichedCandidate);
    const elapsed = stopDraftTimer();
    metricsTracker.increment('articles.generated');
    logger.info(`OpenAI応答を受信: "${article.title}" (${elapsed}ms)`);
  } catch (error) {
    const elapsed = stopDraftTimer();
    metricsTracker.increment('articles.failed');
    logger.error(`⚠️ 記事生成に失敗しました: ${error.message} (${elapsed}ms)`);
    // 候補のステータスを 'failed' に更新
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

  // --- 記事データの後処理 ---
  const normalizedTags = mapArticleTags(article.tags); // タグを正規化
  const hydratedArticle = {
    ...article,
    tags: normalizedTags,
  };
  const selectedImage = selectArticleImage(hydratedArticle, candidate); // 画像を選択

  // --- ファイルパスとメタデータ生成 ---
  const today = new Date().toISOString().split('T')[0];
  const slugifiedTitle = slugify(article.title, topicKey || 'ai-topic');
  const slug = `${today}-${slugifiedTitle}`;
  const fileName = `${slug}.html`;
  const publishRelativePath = path.posix.join('posts', fileName);

  // HTMLテンプレートに渡すメタデータ
  const meta = {
    date: today,
    sourceName: candidate.source.name,
    sourceUrl,
    videoUrl: candidate.video.url,
    videoTitle: candidate.video.title,
    image: selectedImage,
  };

  // --- HTML生成 ---
  const publishHtml = compileArticleHtml(hydratedArticle, meta, {
    assetBase: '../',
    image: selectedImage,
  });

  const now = new Date().toISOString();

  // --- 候補と履歴の更新 ---
  // 候補のステータスを 'generated' に更新
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

  // トピック履歴を更新
  const updatedHistory = updateTopicHistory(topicHistory, topicKey, {
    sourceName: candidate.source.name,
    videoTitle: candidate.video.title,
    draftUrl: publishRelativePath,
    lastPublishedAt: today,
  });
  writeJson(topicHistoryPath, updatedHistory);
  logger.info('candidates と topic-history を更新しました。');

  // --- Publisherステージへの返り値を作成 ---
  // posts.jsonに保存するためのエントリ
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

  // PublisherステージでHTMLファイルを書き込むための詳細データ
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

  // 最終的な結果を返す
  return buildResult({
    generated: true,
    candidateId: candidate.id,
    postEntry,
    draftUrl: publishRelativePath,
    topicKey,
    article: articleData,
  });
};

// スクリプトが直接実行された場合にrunGeneratorを実行
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