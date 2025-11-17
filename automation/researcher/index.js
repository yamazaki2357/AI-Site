#!/usr/bin/env node
/**
 * Researcher
 * - Processes pending candidates from data/candidates.json
 * - Extracts search keywords using OpenAI API
 * - Fetches Google search results and generates summaries
 * - Updates candidates with research data
 */

const path = require('path');
const { readJson, writeJson } = require('../lib/io');
const { extractSearchKeywords } = require('../lib/extractKeywords');
const { searchTopArticles } = require('../lib/googleSearch');
const { decodeHtmlEntities } = require('../lib/text');

const root = path.resolve(__dirname, '..', '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const outputDir = path.join(root, 'automation', 'output', 'researcher');

const GOOGLE_TOP_LIMIT = 3;
const ARTICLE_FETCH_TIMEOUT_MS = 8000;
const ARTICLE_TEXT_MAX_LENGTH = 12000;
const SUMMARY_MIN_LENGTH = 300;
const SUMMARY_MAX_LENGTH = 500;

const USER_AGENT =
  'AIInfoBlogCollector/1.0 (+https://github.com/gray-desk/AI-information-blog)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stripHtmlTags = (html) => {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<\/?head[\s\S]*?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
};

const normalizePlainText = (html) => {
  const stripped = stripHtmlTags(html);
  return decodeHtmlEntities(stripped).replace(/\s+/g, ' ').trim();
};

const fetchArticleText = async (url) => {
  if (!url) return '';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ARTICLE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = await response.text();
    return normalizePlainText(body).slice(0, ARTICLE_TEXT_MAX_LENGTH);
  } catch (error) {
    console.warn(`[researcher] ${url} の本文取得に失敗しました: ${error.message}`);
    return '';
  } finally {
    clearTimeout(timeout);
  }
};

const buildSummaryWithinRange = (text, fallback = '') => {
  const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
  const baseText = normalize(text);
  const fallbackText = normalize(fallback);
  const source = baseText || fallbackText;
  if (!source) return '';

  const sentences = source
    .split(/(?<=[。\.\!?？!])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  let summary = '';
  for (const sentence of sentences) {
    const next = summary ? `${summary}${sentence}` : sentence;
    if (next.length > SUMMARY_MAX_LENGTH) {
      if (summary.length < SUMMARY_MIN_LENGTH) {
        summary = next.slice(0, SUMMARY_MAX_LENGTH);
      }
      break;
    }
    summary = next;
    if (summary.length >= SUMMARY_MAX_LENGTH) break;
  }

  if (!summary) {
    summary = source.slice(0, SUMMARY_MAX_LENGTH);
  }

  if (summary.length < SUMMARY_MIN_LENGTH && source.length > summary.length) {
    summary = source.slice(0, Math.max(SUMMARY_MIN_LENGTH, Math.min(SUMMARY_MAX_LENGTH, source.length)));
  }

  if (summary.length < SUMMARY_MIN_LENGTH && fallbackText && source !== fallbackText) {
    const combined = `${summary} ${fallbackText}`.trim();
    summary = combined.slice(0, Math.max(SUMMARY_MIN_LENGTH, Math.min(SUMMARY_MAX_LENGTH, combined.length)));
  }

  if (summary.length > SUMMARY_MAX_LENGTH) {
    summary = summary.slice(0, SUMMARY_MAX_LENGTH);
  }

  return summary.trim();
};

const summarizeSearchResult = async (item, index) => {
  const title = item.title || `検索結果${index + 1}`;
  const url = item.link;
  const snippet = item.snippet || '';
  let bodyText = '';

  if (url) {
    bodyText = await fetchArticleText(url);
  }

  const summary = buildSummaryWithinRange(bodyText, snippet);
  return {
    title,
    url,
    snippet,
    summary,
  };
};

const fetchSearchSummaries = async (query, apiKey, cx) => {
  if (!query || !apiKey || !cx) return [];
  try {
    const res = await searchTopArticles({
      apiKey,
      cx,
      query,
      num: GOOGLE_TOP_LIMIT,
    });
    const items = Array.isArray(res.items) ? res.items.slice(0, GOOGLE_TOP_LIMIT) : [];
    const summaries = [];
    for (const [index, item] of items.entries()) {
      try {
        const summaryEntry = await summarizeSearchResult(item, index);
        summaries.push(summaryEntry);
      } catch (error) {
        console.warn(
          `[researcher] Google検索結果の要約作成に失敗 (${item?.link || 'unknown'}): ${error.message}`,
        );
        summaries.push({
          title: item.title || `検索結果${index + 1}`,
          url: item.link,
          snippet: item.snippet || '',
          summary: item.snippet || '',
        });
      }
      await sleep(150);
    }
    return summaries;
  } catch (error) {
    console.warn(`[researcher] Google Search API 呼び出しに失敗: ${error.message}`);
    return [];
  }
};

const runResearcher = async () => {
  console.log('[researcher] ステージ開始: pending候補のリサーチを実行します。');

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY が設定されていません。GitHub Secrets に登録してください。');
  }

  const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const googleCx = process.env.GOOGLE_SEARCH_CX;
  if (!googleApiKey || !googleCx) {
    throw new Error('GOOGLE_SEARCH_API_KEY と GOOGLE_SEARCH_CX が設定されていません。GitHub Secrets に登録してください。');
  }

  const candidates = readJson(candidatesPath, []);

  // リサーチが必要な候補を抽出（status=collected）
  const candidatesToResearch = candidates.filter((c) => c.status === 'collected');

  if (candidatesToResearch.length === 0) {
    console.log('[researcher] リサーチが必要な候補がありません（status=collected の候補が0件）。');
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      metrics: {},
    };
  }

  console.log(`[researcher] リサーチ対象: ${candidatesToResearch.length}件`);

  // メトリクス収集
  const metrics = {
    totalProcessed: 0,
    keywordExtraction: {
      success: 0,
      failure: 0,
      fallbackUsed: 0,
    },
    googleSearch: {
      success: 0,
      failure: 0,
      totalResults: 0,
    },
    performance: {
      keywordExtractionTimeMs: [],
      googleSearchTimeMs: [],
    },
  };

  const errors = [];
  let successCount = 0;
  let failureCount = 0;

  for (const candidate of candidatesToResearch) {
    metrics.totalProcessed += 1;
    const video = candidate.video;

    console.log(`[researcher] 処理中: ${video.title}`);

    // キーワード抽出
    let searchQuery = video.title;
    let keywordExtractionMethod = 'fallback';
    const keywordStartTime = Date.now();

    try {
      console.log(`[researcher] キーワード抽出: "${video.title}"`);
      searchQuery = await extractSearchKeywords(
        openaiApiKey,
        video.title,
        video.description,
      );
      const keywordEndTime = Date.now();
      metrics.performance.keywordExtractionTimeMs.push(keywordEndTime - keywordStartTime);

      metrics.keywordExtraction.success += 1;
      keywordExtractionMethod = 'openai';
      console.log(`[researcher] 抽出キーワード: "${searchQuery}" (${keywordEndTime - keywordStartTime}ms)`);
    } catch (error) {
      const keywordEndTime = Date.now();
      metrics.performance.keywordExtractionTimeMs.push(keywordEndTime - keywordStartTime);
      metrics.keywordExtraction.failure += 1;
      metrics.keywordExtraction.fallbackUsed += 1;

      console.error(`[researcher] ⚠️ キーワード抽出失敗: ${error.message}`);
      searchQuery = video.title;
      keywordExtractionMethod = 'fallback';

      errors.push({
        candidateId: candidate.id,
        videoTitle: video.title,
        step: 'keyword-extraction',
        message: error.message,
      });
    }

    // レート制限対策
    await sleep(500);

    // Google検索
    let searchSummaries = [];
    const searchStartTime = Date.now();

    try {
      console.log(`[researcher] Google検索: "${searchQuery}"`);
      searchSummaries = await fetchSearchSummaries(searchQuery, googleApiKey, googleCx);
      const searchEndTime = Date.now();
      metrics.performance.googleSearchTimeMs.push(searchEndTime - searchStartTime);

      metrics.googleSearch.success += 1;
      metrics.googleSearch.totalResults += searchSummaries.length;
      console.log(`[researcher] 検索完了: ${searchSummaries.length}件 (${searchEndTime - searchStartTime}ms)`);
    } catch (error) {
      const searchEndTime = Date.now();
      metrics.performance.googleSearchTimeMs.push(searchEndTime - searchStartTime);
      metrics.googleSearch.failure += 1;

      console.error(`[researcher] ⚠️ Google検索失敗: ${error.message}`);
      searchSummaries = [];

      errors.push({
        candidateId: candidate.id,
        videoTitle: video.title,
        step: 'google-search',
        searchQuery,
        message: error.message,
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
      console.error(`[researcher] ⚠️ 候補が見つかりません: ${candidate.id}`);
    }

    // レート制限対策
    await sleep(1000);
  }

  // 更新されたcandidatesを保存
  writeJson(candidatesPath, candidates);

  // 成果物を保存
  const { ensureDir } = require('../lib/io');
  ensureDir(outputDir);
  const timestamp = new Date().toISOString();
  const outputData = {
    timestamp,
    processed: metrics.totalProcessed,
    succeeded: successCount,
    failed: failureCount,
    metrics,
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
  console.log(`[researcher] 成果物を保存しました: ${outputPath}`);

  // メトリクスサマリー
  const avgKeywordTime = metrics.performance.keywordExtractionTimeMs.length > 0
    ? Math.round(metrics.performance.keywordExtractionTimeMs.reduce((a, b) => a + b, 0) / metrics.performance.keywordExtractionTimeMs.length)
    : 0;
  const avgSearchTime = metrics.performance.googleSearchTimeMs.length > 0
    ? Math.round(metrics.performance.googleSearchTimeMs.reduce((a, b) => a + b, 0) / metrics.performance.googleSearchTimeMs.length)
    : 0;

  console.log('\n=== Researcher メトリクスサマリー ===');
  console.log(`処理候補数: ${metrics.totalProcessed}件`);
  console.log(`成功: ${successCount}件 / 失敗: ${failureCount}件`);
  console.log(`キーワード抽出: 成功 ${metrics.keywordExtraction.success}件 / 失敗 ${metrics.keywordExtraction.failure}件 (フォールバック: ${metrics.keywordExtraction.fallbackUsed}件)`);
  console.log(`Google検索: 成功 ${metrics.googleSearch.success}件 / 失敗 ${metrics.googleSearch.failure}件 (平均 ${metrics.googleSearch.totalResults / Math.max(metrics.googleSearch.success, 1) | 0}件/検索)`);
  console.log(`平均処理時間: キーワード抽出 ${avgKeywordTime}ms / Google検索 ${avgSearchTime}ms`);

  if (errors.length > 0) {
    console.log(`\n⚠️  警告: ${errors.length}件のエラーが発生しました`);
    const errorsByStep = errors.reduce((acc, err) => {
      acc[err.step] = (acc[err.step] || 0) + 1;
      return acc;
    }, {});
    Object.entries(errorsByStep).forEach(([step, count]) => {
      console.log(`  - ${step}: ${count}件`);
    });
  }

  console.log(`\n[researcher] 完了: ${successCount}件のリサーチが完了しました。`);

  return {
    processed: metrics.totalProcessed,
    succeeded: successCount,
    failed: failureCount,
    errors,
    metrics: {
      totalProcessed: metrics.totalProcessed,
      keywordExtraction: {
        ...metrics.keywordExtraction,
        successRate: metrics.totalProcessed > 0
          ? Math.round((metrics.keywordExtraction.success / metrics.totalProcessed) * 100)
          : 0,
      },
      googleSearch: {
        ...metrics.googleSearch,
        successRate: (metrics.googleSearch.success + metrics.googleSearch.failure) > 0
          ? Math.round((metrics.googleSearch.success / (metrics.googleSearch.success + metrics.googleSearch.failure)) * 100)
          : 0,
        avgResultsPerSearch: metrics.googleSearch.success > 0
          ? Math.round(metrics.googleSearch.totalResults / metrics.googleSearch.success)
          : 0,
      },
      performance: {
        avgKeywordExtractionTimeMs: avgKeywordTime,
        avgGoogleSearchTimeMs: avgSearchTime,
      },
    },
  };
};

if (require.main === module) {
  runResearcher()
    .then((result) => {
      console.log('Researcher finished:', result);
    })
    .catch((error) => {
      console.error('Researcher failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runResearcher,
};
