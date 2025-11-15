#!/usr/bin/env node
/**
 * Collector
 * - Fetches latest YouTube videos from registered sources via YouTube Data API v3.
 * - Stores blog-worthy candidates into data/candidates.json for generator stage.
 */

const path = require('path');
const { readJson, writeJson, ensureDir } = require('../lib/io');
const slugify = require('../lib/slugify');
const { searchTopArticles } = require('../lib/googleSearch');
const { decodeHtmlEntities } = require('../lib/text');

const root = path.resolve(__dirname, '..', '..');
const sourcesPath = path.join(root, 'data', 'sources.json');
const candidatesPath = path.join(root, 'data', 'candidates.json');

const MAX_PER_CHANNEL = 2;
const VIDEO_LOOKBACK_DAYS = 7;
const SEARCH_PAGE_SIZE = 10;
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const GOOGLE_TOP_LIMIT = 3;
const ARTICLE_FETCH_TIMEOUT_MS = 8000;
const ARTICLE_TEXT_MAX_LENGTH = 12000;
const SUMMARY_MIN_LENGTH = 300;
const SUMMARY_MAX_LENGTH = 500;
const CLEANUP_PROCESSED_DAYS = 14;
const MAX_PENDING_CANDIDATES = 30;

const USER_AGENT =
  'AIInfoBlogCollector/1.0 (+https://github.com/yamazaki/AI-information-blog)';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createChannelUrl = (channelId) =>
  channelId ? `https://www.youtube.com/channel/${channelId}` : null;

const withinWindow = (publishedAt) => {
  if (!publishedAt) return false;
  const publishedTime = new Date(publishedAt).getTime();
  if (Number.isNaN(publishedTime)) return false;
  const ageMs = Date.now() - publishedTime;
  const windowMs = VIDEO_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  return ageMs <= windowMs;
};

const normalizeSource = (source) => {
  const channelId = source.channelId || null;
  const baseUrl = source.url || createChannelUrl(channelId);
  return {
    platform: source.platform || 'YouTube',
    name: source.name || 'Unknown Channel',
    channelId,
    url: baseUrl || createChannelUrl(channelId),
    focus: Array.isArray(source.focus) ? source.focus : [],
  };
};

const mapSnippetToVideo = (item) => {
  const snippet = item.snippet;
  const videoId = item.id?.videoId;
  if (!snippet || !videoId) return null;
  return {
    id: videoId,
    title: snippet.title ?? 'Untitled',
    description: snippet.description ?? '',
    thumbnail:
      snippet.thumbnails?.maxres?.url ||
      snippet.thumbnails?.high?.url ||
      snippet.thumbnails?.medium?.url ||
      snippet.thumbnails?.default?.url ||
      null,
    publishedAt: snippet.publishedAt,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
};

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
    console.warn(`[collector] ${url} の本文取得に失敗しました: ${error.message}`);
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
          `[collector] Google検索結果の要約作成に失敗 (${item?.link || 'unknown'}): ${error.message}`,
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
    console.warn(`[collector] Google Search API 呼び出しに失敗: ${error.message}`);
    return [];
  }
};

const fetchChannelVideos = async (channelId, apiKey) => {
  const publishedAfter = new Date(Date.now() - VIDEO_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('.')[0] + 'Z';
  const params = new URLSearchParams({
    key: apiKey,
    part: 'snippet',
    channelId,
    order: 'date',
    type: 'video',
    maxResults: `${SEARCH_PAGE_SIZE}`,
    publishedAfter,
  });
  const response = await fetch(`${YOUTUBE_API_BASE}/search?${params.toString()}`);
  if (!response.ok) {
    const errorText = await response.text();
    let quotaExceeded = false;
    let errorMessage = errorText.slice(0, 200);
    try {
      const errorPayload = JSON.parse(errorText);
      errorMessage = errorPayload?.error?.message || errorMessage;
      const reasons = errorPayload?.error?.errors;
      quotaExceeded = Array.isArray(reasons) && reasons.some((entry) => entry.reason === 'quotaExceeded');
    } catch {
      // ignore JSON parse errors and fall back to raw text
    }
    if (response.status === 403 && quotaExceeded) {
      console.warn(`[collector] quota exceeded: スキップします (channel=${channelId})`);
      return null;
    }
    throw new Error(`YouTube API error ${response.status}: ${errorMessage}`);
  }
  const payload = await response.json();
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items
    .map((item) => mapSnippetToVideo(item))
    .filter((video) => Boolean(video));
};

const runCollector = async () => {
  console.log('[collector] ステージ開始: YouTube Data APIで最新動画を取得します。');
  ensureDir(path.dirname(candidatesPath));

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error('YOUTUBE_API_KEY が設定されていません。GitHub Secrets に登録してください。');
  }
  const googleApiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const googleCx = process.env.GOOGLE_SEARCH_CX;
  if (!googleApiKey || !googleCx) {
    console.log('[collector] Google検索キーが設定されていないため、リサーチ要約は空になります。');
  }

  const sources = readJson(sourcesPath, []);
  const existingCandidates = readJson(candidatesPath, []);

  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('data/sources.json に監視対象が設定されていません。');
  }

  let updatedCandidates = [...existingCandidates];
  const summaryItems = [];
  const errors = [];
  let newCandidatesCount = 0;

  for (const [index, source] of sources.entries()) {
    const normalizedSource = normalizeSource(source);
    console.log(
      `[collector] (${index + 1}/${sources.length}) ${normalizedSource.name} の最新動画を取得します`,
    );

    if (!normalizedSource.channelId) {
      console.warn(
        `[collector] ${normalizedSource.name}: channelId が設定されていないためスキップします。`,
      );
      errors.push({
        source: normalizedSource.name,
        message: 'channelId is missing',
      });
      continue;
    }

    try {
      const videos = await fetchChannelVideos(normalizedSource.channelId, apiKey);
      if (!Array.isArray(videos)) {
        console.log(
          `[collector] ${normalizedSource.name}: YouTube API制限によりこのチャンネルの処理をスキップしました。`,
        );
        continue;
      }
      const freshVideos = videos
        .filter((video) => withinWindow(video.publishedAt))
        .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

      console.log(
        `[collector] ${normalizedSource.name}: API取得 ${videos.length}件 / フィルタ後 ${freshVideos.length}件`,
      );

      let addedForChannel = 0;
      for (const video of freshVideos) {
        if (addedForChannel >= MAX_PER_CHANNEL) break;
        const candidateId = `yt-${video.id}`;
        const alreadyExists = updatedCandidates.some((candidate) => candidate.id === candidateId);
        if (alreadyExists) continue;

        const now = new Date().toISOString();
        const topicKey = slugify(video.title);
        const searchQuery = video.title;
        let searchSummaries = [];
        if (googleApiKey && googleCx && searchQuery) {
          console.log(
            `[collector] Google検索で補足情報を収集します: "${searchQuery}" (最大${GOOGLE_TOP_LIMIT}件)`,
          );
          searchSummaries = await fetchSearchSummaries(searchQuery, googleApiKey, googleCx);
        }

        updatedCandidates.push({
          id: candidateId,
          source: normalizedSource,
          video: {
            id: video.id,
            title: video.title,
            url: video.url,
            description: video.description,
            thumbnail: video.thumbnail,
            publishedAt: video.publishedAt,
          },
          searchQuery,
          searchSummaries,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
          topicKey,
          notes: `YouTube Data API: ${normalizedSource.name} の最新動画`,
        });

        summaryItems.push({
          title: video.title,
          description: video.description,
          url: video.url,
          thumbnail: video.thumbnail,
          publishedAt: video.publishedAt,
          searchSummaries,
        });

        newCandidatesCount += 1;
        addedForChannel += 1;
        console.log(
          `[collector] 新規候補を追加: ${normalizedSource.name} / ${video.title} (candidateId: ${candidateId})`,
        );
      }

      if (addedForChannel === 0) {
        console.log(`[collector] ${normalizedSource.name}: 新規候補はありませんでした。`);
      }
    } catch (error) {
      console.warn(`[collector] ${normalizedSource.name} でエラー: ${error.message}`);
      errors.push({
        source: normalizedSource.name,
        message: error.message,
      });
    }
  }

  updatedCandidates.sort((a, b) => {
    const aTime = new Date(a.video?.publishedAt || 0).getTime();
    const bTime = new Date(b.video?.publishedAt || 0).getTime();
    return bTime - aTime;
  });

  // クリーンアップ: 処理済み候補を14日後に削除
  const now = Date.now();
  const cleanupCutoff = now - CLEANUP_PROCESSED_DAYS * 24 * 60 * 60 * 1000;
  const beforeCleanup = updatedCandidates.length;

  updatedCandidates = updatedCandidates.filter((candidate) => {
    if (candidate.status === 'pending') return true;
    const updatedTime = new Date(candidate.updatedAt || candidate.createdAt).getTime();
    return !Number.isNaN(updatedTime) && updatedTime >= cleanupCutoff;
  });

  const cleanedCount = beforeCleanup - updatedCandidates.length;
  if (cleanedCount > 0) {
    console.log(`[collector] 処理済み候補を${cleanedCount}件削除しました（${CLEANUP_PROCESSED_DAYS}日以上経過）。`);
  }

  // クリーンアップ: pending候補を30件に制限
  const pendingCandidates = updatedCandidates.filter((c) => c.status === 'pending');
  const processedCandidates = updatedCandidates.filter((c) => c.status !== 'pending');

  if (pendingCandidates.length > MAX_PENDING_CANDIDATES) {
    const beforeLimit = pendingCandidates.length;
    const limitedPending = pendingCandidates
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, MAX_PENDING_CANDIDATES);
    updatedCandidates = [...processedCandidates, ...limitedPending];
    updatedCandidates.sort((a, b) => {
      const aTime = new Date(a.video?.publishedAt || 0).getTime();
      const bTime = new Date(b.video?.publishedAt || 0).getTime();
      return bTime - aTime;
    });
    const limitedCount = beforeLimit - limitedPending.length;
    console.log(`[collector] pending候補を${limitedCount}件削除しました（上限${MAX_PENDING_CANDIDATES}件を超過）。`);
  }

  writeJson(candidatesPath, updatedCandidates);

  if (errors.length > 0) {
    console.log(`[collector] 警告: ${errors.length}件のソースでエラーが発生しました。`);
  }

  if (summaryItems.length === 0) {
    console.log('[collector] 今回は新規候補がありませんでした。');
  }

  console.log(
    `[collector] 完了: 新規${newCandidatesCount}件 / 総候補${updatedCandidates.length}件`,
  );

  return {
    source: 'YouTube',
    items: summaryItems,
    checkedSources: sources.length,
    newCandidates: newCandidatesCount,
    totalCandidates: updatedCandidates.length,
    errors,
  };
};

if (require.main === module) {
  runCollector()
    .then((result) => {
      console.log('Collector finished:', result);
    })
    .catch((error) => {
      console.error('Collector failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runCollector,
};
