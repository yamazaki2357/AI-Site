#!/usr/bin/env node
/**
 * @fileoverview Researcher: キーワードベースのGoogle検索・要約ツール
 * - 指定されたキーワードでGoogle検索を1回だけ実行します。
 * - 上位3件の検索結果を取得し、OpenAI APIで要約します。
 * - SNSドメインは自動的に除外されます。
 *
 * 重要な設計方針:
 * - Google検索は1回のみ実行されます。リトライや再試行はしません。
 * - 要約は最大3件まで生成されます。
 * - 無限ループを防ぐため、再検索や再抽出は行いません。
 */

const path = require('path');
const { ensureDir, writeJson } = require('../lib/io');
const { searchTopArticles } = require('../lib/googleSearch');
const { RESEARCHER, RATE_LIMITS } = require('../config/constants');
const { createLogger } = require('../lib/logger');
const { createMetricsTracker } = require('../lib/metrics');
const { summarizeSearchResult } = require('./services/summaryBuilder');

// --- パス設定 ---
const root = path.resolve(__dirname, '..', '..');
const outputDir = path.join(root, 'automation', 'output', 'researcher');

// --- 定数設定 ---
const { GOOGLE_TOP_LIMIT } = RESEARCHER; // 取得する記事数（constants.js から取得）
const logger = createLogger('researcher');
const metricsTracker = createMetricsTracker('researcher');

/**
 * 指定されたミリ秒だけ処理を待機します。
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Google検索結果から除外するドメインのリスト
const BLOCKED_DOMAINS = [
  'x.com',
  'twitter.com',
  't.co',
  'facebook.com',
  'instagram.com',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'm.youtube.com',
  'reddit.com',
  'pinterest.com',
];

/**
 * URLが除外対象のドメインに一致するか判定します。
 */
const shouldSkipResult = (url) => {
  if (!url) return true;
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BLOCKED_DOMAINS.some(
      (blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`),
    );
  } catch {
    return true;
  }
};

/**
 * Googleで検索し、上位記事の要約を生成します。
 *
 * @param {string} query - 検索クエリ
 * @param {string} googleApiKey - Google Search APIキー
 * @param {string} googleCx - Googleカスタム検索エンジンID
 * @param {string} openaiApiKey - OpenAI APIキー
 * @returns {Promise<Array<object>>} 要約情報の配列（最大3件）
 */
const fetchSearchSummaries = async (query, googleApiKey, googleCx, openaiApiKey) => {
  if (!query || !googleApiKey || !googleCx) return [];

  try {
    const desiredCount = GOOGLE_TOP_LIMIT; // 3件
    // SNS除外を考慮し、多めにリクエスト（最大10件）
    const requestCount = Math.min(desiredCount * 3, 10);

    logger.info(`[Google検索] 開始: "${query}"`);

    // Google検索を実行（1回のみ）
    const res = await searchTopArticles({
      apiKey: googleApiKey,
      cx: googleCx,
      query,
      num: requestCount,
    });

    const items = Array.isArray(res.items) ? res.items : [];
    logger.info(`[Google検索] 結果取得: ${items.length}件`);

    // SNS/除外ドメインをフィルタリング
    const filteredItems = items.filter((item) => !shouldSkipResult(item.link));

    const skippedCount = items.length - filteredItems.length;
    if (skippedCount > 0) {
      logger.info(`[フィルタリング] SNS/除外ドメイン: ${skippedCount}件スキップ`);
    }

    // 上位3件に絞る
    const limitedItems = filteredItems.slice(0, desiredCount);
    logger.info(`[処理対象] ${limitedItems.length}件を要約します`);

    const summaries = [];

    // 各検索結果を要約
    for (const [index, item] of limitedItems.entries()) {
      try {
        logger.info(`[要約] (${index + 1}/${limitedItems.length})`);
        const summaryEntry = await summarizeSearchResult(item, index, openaiApiKey);
        summaries.push(summaryEntry);
        logger.info(`[要約完了] (${index + 1}/${limitedItems.length}): ${summaryEntry.title}`);
      } catch (error) {
        logger.warn(`[要約失敗] ${item?.link || 'unknown'}: ${error.message}`);
        // フォールバック: スニペットを使用
        summaries.push({
          title: item.title || `検索結果${index + 1}`,
          url: item.link,
          snippet: item.snippet || '',
          summary: item.snippet || '',
        });
      }

      // APIレート制限対策
      await sleep(RATE_LIMITS.SEARCH_RESULT_WAIT_MS);
    }

    return summaries;
  } catch (error) {
    logger.warn(`[Google検索失敗] ${error.message}`);
    return [];
  }
};

/**
 * Researcherのメイン処理
 *
 * @param {object} options - オプション
 * @param {string} options.keyword - 検索キーワード（必須）
 * @returns {Promise<object>} { keyword, summaries }
 */
const runResearcher = async ({ keyword }) => {
  if (!keyword) {
    throw new Error('keyword パラメータは必須です。');
  }

  logger.info('=== Researcher 開始 ===');
  logger.info(`検索キーワード: "${keyword}"`);

  // 環境変数からAPIキーを取得
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY が設定されていません。');
  }

  const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const googleCx = process.env.GOOGLE_SEARCH_CX;
  if (!googleApiKey || !googleCx) {
    throw new Error('GOOGLE_SEARCH_API_KEY と GOOGLE_SEARCH_CX が設定されていません。');
  }

  // Google検索と要約（1回のみ）
  const stopTimer = metricsTracker.startTimer('googleSearch.timeMs');
  let summaries = [];

  try {
    summaries = await fetchSearchSummaries(keyword, googleApiKey, googleCx, openaiApiKey);
    const elapsed = stopTimer();

    metricsTracker.increment('googleSearch.success');
    metricsTracker.increment('googleSearch.totalResults', summaries.length);
    logger.info(`[Google検索] 完了: ${summaries.length}件の要約を取得 (${elapsed}ms)`);
  } catch (error) {
    const elapsed = stopTimer();
    metricsTracker.increment('googleSearch.failure');
    logger.error(`[Google検索] 失敗 (${elapsed}ms): ${error.message}`);
    summaries = [];
  }

  // 成果物の保存
  ensureDir(outputDir);
  const timestamp = new Date().toISOString();
  const outputData = {
    timestamp,
    keyword,
    summariesCount: summaries.length,
    summaries,
    metrics: metricsTracker.summary(),
  };

  const outputPath = path.join(outputDir, `researcher-${timestamp.split('T')[0]}.json`);
  writeJson(outputPath, outputData);
  logger.info(`成果物を保存: ${outputPath}`);

  // メトリクスサマリー
  logger.info('\n=== Researcher 完了 ===');
  logger.info(`検索キーワード: "${keyword}"`);
  logger.info(`要約件数: ${summaries.length}件`);

  // 結果を返す
  return {
    keyword,
    summaries,
  };
};

// スクリプトが直接実行された場合
if (require.main === module) {
  const { parseArgs } = require('util');

  // CLI引数のパース
  const options = {
    keyword: {
      type: 'string',
      short: 'k',
    },
  };

  let keyword;
  try {
    const parsed = parseArgs({ options, strict: false });
    keyword = parsed.values.keyword;
  } catch (e) {
    // フォールバック
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--keyword' || argv[i] === '-k') keyword = argv[i + 1];
    }
  }

  // 位置引数のフォールバック (後方互換性)
  if (!keyword && process.argv[2] && !process.argv[2].startsWith('-')) {
    keyword = process.argv[2];
  }

  if (!keyword) {
    console.error('使用方法: node researcher/index.js --keyword "検索キーワード"');
    process.exit(1);
  }

  runResearcher({ keyword })
    .then((result) => {
      console.log('Researcher finished:', JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error('Researcher failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runResearcher,
};
