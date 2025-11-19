#!/usr/bin/env node
/**
 * Researcher
 * - Processes collected candidates from data/candidates.json
 * - Extracts search keywords using OpenAI API
 * - Fetches Google search results and generates summaries
 * - Updates candidates with research data (status -> researched)
 */

const path = require('path');
const { writeJson, ensureDir } = require('../lib/io');
const { extractSearchKeywords } = require('../lib/extractKeywords');
const { searchTopArticles } = require('../lib/googleSearch');
const slugify = require('../lib/slugify');
const { RESEARCHER, RATE_LIMITS } = require('../config/constants');
const { deriveTopicKey } = require('../lib/topicKey');
const { readCandidates, writeCandidates } = require('../lib/candidatesRepository');
const { createLogger } = require('../lib/logger');
const { createMetricsTracker, average } = require('../lib/metrics');
const { summarizeSearchResult } = require('./services/summaryBuilder');

const root = path.resolve(__dirname, '..', '..');
const outputDir = path.join(root, 'automation', 'output', 'researcher');

const { GOOGLE_TOP_LIMIT } = RESEARCHER;
const logger = createLogger('researcher');
const metricsTracker = createMetricsTracker('researcher');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const BLOCKED_DOMAINS = [
  'x.com',
  'twitter.com',
  't.co',
  'facebook.com',
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'm.youtube.com',
];

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

const fetchSearchSummaries = async (query, googleApiKey, googleCx, openaiApiKey) => {
  if (!query || !googleApiKey || !googleCx) return [];
  try {
    const desiredCount = Math.max(1, GOOGLE_TOP_LIMIT);
    const requestCount = Math.min(desiredCount * 3, 10);
    const res = await searchTopArticles({
      apiKey: googleApiKey,
      cx: googleCx,
      query,
      num: requestCount,
    });
    const items = Array.isArray(res.items) ? res.items : [];
    const filteredItems = items.filter((item) => {
      const skip = shouldSkipResult(item.link);
      if (skip && item?.link) {
        logger.info(`SNS結果をスキップ: ${item.link}`);
      }
      return !skip;
    });
    const limitedItems = filteredItems.length > 0
      ? filteredItems.slice(0, desiredCount)
      : items.slice(0, desiredCount);
    const summaries = [];
    for (const [index, item] of limitedItems.entries()) {
      try {
        const summaryEntry = await summarizeSearchResult(item, index, openaiApiKey);
        summaries.push(summaryEntry);
        logger.info(
          `要約完了 (${index + 1}/${limitedItems.length}): ${summaryEntry.title} - ${summaryEntry.summary.length}文字`,
        );
      } catch (error) {
        logger.warn(
          `Google検索結果の要約作成に失敗 (${item?.link || 'unknown'}): ${error.message}`,
        );
        summaries.push({
          title: item.title || `検索結果${index + 1}`,
          url: item.link,
          snippet: item.snippet || '',
          summary: item.snippet || '',
        });
      }
      await sleep(RATE_LIMITS.SEARCH_RESULT_WAIT_MS);
    }
    return summaries;
  } catch (error) {
    logger.warn(`Google Search API 呼び出しに失敗: ${error.message}`);
    return [];
  }
};

const runResearcher = async () => {
  logger.info('ステージ開始: pending候補のリサーチを実行します。');

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY が設定されていません。GitHub Secrets に登録してください。');
  }

  const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const googleCx = process.env.GOOGLE_SEARCH_CX;
  if (!googleApiKey || !googleCx) {
    throw new Error('GOOGLE_SEARCH_API_KEY と GOOGLE_SEARCH_CX が設定されていません。GitHub Secrets に登録してください。');
  }

  const candidates = readCandidates();

  // リサーチが必要な候補を抽出（status=collected）
  const candidatesToResearch = candidates.filter((c) => c.status === 'collected');

  if (candidatesToResearch.length === 0) {
    logger.info('リサーチが必要な候補がありません（status=collected の候補が0件）。');
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      metrics: {},
    };
  }

  logger.info(`リサーチ対象: ${candidatesToResearch.length}件`);

  const errors = [];
  let successCount = 0;
  let failureCount = 0;

  for (const candidate of candidatesToResearch) {
    metricsTracker.increment('candidates.processed');
    const video = candidate.video;

    logger.info(`処理中: ${video.title}`);

    // キーワード抽出
    let searchQuery = video.title;
    let keywordExtractionMethod = 'fallback';
    const keywordStartTime = Date.now();

    try {
      logger.info(`キーワード抽出開始: "${video.title}"`);
      searchQuery = await extractSearchKeywords(
        openaiApiKey,
        video.title,
        video.description,
      );
      const keywordEndTime = Date.now();
      metricsTracker.recordDuration('keywordExtraction.timeMs', keywordEndTime - keywordStartTime);

      // 抽出されたキーワードが元のタイトルと同じ場合は警告
      if (searchQuery === video.title) {
        logger.warn(`⚠️ キーワード抽出が元のタイトルと同じです: "${searchQuery}"`);
      }

      metricsTracker.increment('keywordExtraction.success');
      keywordExtractionMethod = 'openai';
      logger.info(
        `✓ 抽出キーワード: "${searchQuery}" (元: "${video.title.substring(0, 30)}...", ${keywordEndTime - keywordStartTime}ms)`,
      );
    } catch (error) {
      const keywordEndTime = Date.now();
      metricsTracker.increment('keywordExtraction.failure');
      metricsTracker.increment('keywordExtraction.fallback');

      logger.error(`⚠️ キーワード抽出失敗: ${error.message}`);
      logger.error(`  - エラー詳細: ${error.stack || 'スタックトレースなし'}`);
      logger.error(`  - 対象タイトル: "${video.title}"`);
      searchQuery = video.title;
      keywordExtractionMethod = 'fallback';

      errors.push({
        candidateId: candidate.id,
        videoTitle: video.title,
        step: 'keyword-extraction',
        message: error.message,
        errorStack: error.stack,
      });
    }

    // レート制限対策
    await sleep(RATE_LIMITS.KEYWORD_EXTRACTION_WAIT_MS);

    // トピックキー抽出
    let topicKeyInfo = {
      topicKey: slugify(video.title, 'ai-topic'),
      method: 'fallback',
      raw: video.title,
    };
    try {
      topicKeyInfo = await deriveTopicKey(openaiApiKey, video, candidate.source);
      const confidenceText =
        typeof topicKeyInfo.confidence === 'number'
          ? topicKeyInfo.confidence.toFixed(2)
          : 'n/a';
      logger.info(`トピックキー抽出: ${topicKeyInfo.topicKey} (confidence: ${confidenceText})`);
    } catch (error) {
      logger.warn(`トピックキー抽出に失敗: ${error.message}`);
      topicKeyInfo = {
        topicKey: slugify(video.title, 'ai-topic'),
        method: 'fallback',
        raw: video.title,
        error: error.message,
      };
    }

    // Google検索
    let searchSummaries = [];
    const stopSearchTimer = metricsTracker.startTimer('googleSearch.timeMs');

    try {
      logger.info(`Google検索: "${searchQuery}"`);
      searchSummaries = await fetchSearchSummaries(searchQuery, googleApiKey, googleCx, openaiApiKey);
      const elapsed = stopSearchTimer();

      metricsTracker.increment('googleSearch.success');
      metricsTracker.increment('googleSearch.totalResults', searchSummaries.length);
      logger.info(`検索完了: ${searchSummaries.length}件 (${elapsed}ms)`);
    } catch (error) {
      const elapsed = stopSearchTimer();
      metricsTracker.increment('googleSearch.failure');

      logger.error(`⚠️ Google検索失敗: ${error.message}`);
      logger.error(`  - エラー詳細: ${error.stack || 'スタックトレースなし'}`);
      logger.error(`  - 検索クエリ: "${searchQuery}" (elapsed ${elapsed}ms)`);
      searchSummaries = [];

      errors.push({
        candidateId: candidate.id,
        videoTitle: video.title,
        step: 'google-search',
        searchQuery,
        message: error.message,
        errorStack: error.stack,
      });
    }

    // 候補を更新
    const now = new Date().toISOString();
    const updatedCandidate = {
      ...candidate,
      searchQuery: {
        original: video.title,
        extracted: searchQuery,
        method: keywordExtractionMethod,
      },
      topicKey: topicKeyInfo.topicKey,
      topicKeyMeta: {
        method: topicKeyInfo.method,
        raw: topicKeyInfo.raw || topicKeyInfo.topicKey,
        product: topicKeyInfo.product || null,
        feature: topicKeyInfo.feature || null,
        category: topicKeyInfo.category || null,
        confidence: typeof topicKeyInfo.confidence === 'number' ? topicKeyInfo.confidence : null,
        reasoning: topicKeyInfo.reasoning || null,
        error: topicKeyInfo.error || null,
      },
      searchSummaries,
      status: 'researched',
      researchedAt: now,
      updatedAt: now,
    };

    // candidates配列を更新
    const candidateIndex = candidates.findIndex((c) => c.id === candidate.id);
    if (candidateIndex !== -1) {
      candidates[candidateIndex] = updatedCandidate;
      successCount += 1;
    } else {
      failureCount += 1;
      logger.error(`⚠️ 候補が見つかりません: ${candidate.id}`);
    }

    // レート制限対策
    await sleep(RATE_LIMITS.CANDIDATE_PROCESSING_WAIT_MS);
  }

  // 更新されたcandidatesを保存
  writeCandidates(candidates);

  // 成果物を保存
  ensureDir(outputDir);
  const timestamp = new Date().toISOString();
  // メトリクスサマリー
  const keywordDurations = metricsTracker.getTimings('keywordExtraction.timeMs');
  const googleDurations = metricsTracker.getTimings('googleSearch.timeMs');
  const avgKeywordTime = average(keywordDurations);
  const avgSearchTime = average(googleDurations);
  const totalProcessed = metricsTracker.getCounter('candidates.processed');
  const keywordSuccess = metricsTracker.getCounter('keywordExtraction.success');
  const keywordFailure = metricsTracker.getCounter('keywordExtraction.failure');
  const fallbackUsed = metricsTracker.getCounter('keywordExtraction.fallback');
  const googleSuccess = metricsTracker.getCounter('googleSearch.success');
  const googleFailure = metricsTracker.getCounter('googleSearch.failure');
  const totalSearches = googleSuccess + googleFailure;
  const totalResults = metricsTracker.getCounter('googleSearch.totalResults');
  const avgResultsPerSearch = googleSuccess > 0 ? Math.round(totalResults / googleSuccess) : 0;

  const metricsReport = {
    totalProcessed,
    keywordExtraction: {
      success: keywordSuccess,
      failure: keywordFailure,
      fallbackUsed,
      successRate: totalProcessed > 0 ? Math.round((keywordSuccess / totalProcessed) * 100) : 0,
    },
    googleSearch: {
      success: googleSuccess,
      failure: googleFailure,
      totalResults,
      successRate: totalSearches > 0 ? Math.round((googleSuccess / totalSearches) * 100) : 0,
      avgResultsPerSearch,
    },
    performance: {
      avgKeywordExtractionTimeMs: avgKeywordTime,
      avgGoogleSearchTimeMs: avgSearchTime,
    },
  };

  const outputData = {
    timestamp,
    processed: totalProcessed,
    succeeded: successCount,
    failed: failureCount,
    metrics: metricsReport,
    errors,
    researchedCandidates: candidates
      .filter((c) => c.status === 'researched' && c.researchedAt && new Date(c.researchedAt).getTime() > Date.now() - 3600000)
      .map((c) => ({
        id: c.id,
        videoTitle: c.video.title,
        searchQuery: c.searchQuery,
        searchSummariesCount: c.searchSummaries?.length || 0,
        researchedAt: c.researchedAt,
      })),
  };

  const outputPath = path.join(outputDir, `researcher-${timestamp.split('T')[0]}.json`);
  writeJson(outputPath, outputData);
  logger.info(`成果物を保存しました: ${outputPath}`);

  logger.info('\n=== Researcher メトリクスサマリー ===');
  logger.info(`処理候補数: ${totalProcessed}件`);
  logger.info(`成功: ${successCount}件 / 失敗: ${failureCount}件`);
  logger.info(
    `キーワード抽出: 成功 ${keywordSuccess}件 / 失敗 ${keywordFailure}件 (フォールバック: ${fallbackUsed}件)`,
  );
  logger.info(
    `Google検索: 成功 ${googleSuccess}件 / 失敗 ${googleFailure}件 (平均 ${avgResultsPerSearch}件/検索)`,
  );
  logger.info(`平均処理時間: キーワード抽出 ${avgKeywordTime}ms / Google検索 ${avgSearchTime}ms`);

  if (errors.length > 0) {
    logger.warn(`\n⚠️  警告: ${errors.length}件のエラーが発生しました`);
    const errorsByStep = errors.reduce((acc, err) => {
      acc[err.step] = (acc[err.step] || 0) + 1;
      return acc;
    }, {});
    Object.entries(errorsByStep).forEach(([step, count]) => {
      logger.warn(`  - ${step}: ${count}件`);
    });
  }

  logger.success(`\n完了: ${successCount}件のリサーチが完了しました。`);

  return {
    processed: metrics.totalProcessed,
    succeeded: successCount,
    failed: failureCount,
    errors,
    metrics: metricsReport,
  };
};

if (require.main === module) {
  runResearcher()
    .then((result) => {
      logger.info('Researcher finished:', result);
    })
    .catch((error) => {
      logger.error('Researcher failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runResearcher,
};
