#!/usr/bin/env node
/**
 * Collector
 * - Fetches latest YouTube videos from registered sources (via public feeds).
 * - Stores blog-worthy candidates into data/candidates.json for generator stage.
 */

const path = require('path');
const { readJson, writeJson, ensureDir } = require('../lib/io');
const slugify = require('../lib/slugify');
const { extractText } = require('../lib/text');

const root = path.resolve(__dirname, '..', '..');
const sourcesPath = path.join(root, 'data', 'sources.json');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const cacheDir = path.join(root, 'automation', 'cache');
const channelCachePath = path.join(cacheDir, 'channel-ids.json');

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const NEW_ENTRY_LIMIT = 2; // keep up to two fresh videos per channel
const VIDEO_MAX_AGE_DAYS = 2;

const fetchChannelId = async (source, cache) => {
  if (source.channelId) return source.channelId;
  if (cache[source.url]) return cache[source.url];

  const response = await fetch(source.url, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`Failed to load channel page (${response.status})`);
  }
  const html = await response.text();
  const match = html.match(/"channelId":"(UC[^"]+)"/);
  if (!match) {
    throw new Error('Could not locate channelId in channel page');
  }
  const channelId = match[1];
  cache[source.url] = channelId;
  ensureDir(cacheDir);
  writeJson(channelCachePath, cache);
  return channelId;
};

const getTag = (xml, tag) => {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? extractText(match[1]) : null;
};

const getLink = (xml) => {
  const match = xml.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/i);
  return match ? match[1] : null;
};

const parseEntries = (xml) => {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml))) {
    const entryXml = match[1];
    const title = getTag(entryXml, 'title');
    const published = getTag(entryXml, 'published');
    const description = getTag(entryXml, 'media:description') || '';
    const videoId = getTag(entryXml, 'yt:videoId');
    const link = getLink(entryXml);
    if (!title || !videoId || !link) continue;
    entries.push({
      videoId,
      title,
      link,
      description,
      publishedAt: published,
    });
  }
  return entries;
};

const withinAgeLimit = (publishedAt) => {
  if (!publishedAt) return false;
  const publishedTime = new Date(publishedAt).getTime();
  if (Number.isNaN(publishedTime)) return false;
  const ageMs = Date.now() - publishedTime;
  const limitMs = VIDEO_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  return ageMs <= limitMs;
};

const normalizeSource = (source) => ({
  platform: source.platform || 'YouTube',
  name: source.name || 'Unknown Channel',
  url: source.url,
  focus: Array.isArray(source.focus) ? source.focus : [],
});

const runCollector = async () => {
  console.log('[collector] ステージ開始: YouTubeフィードの巡回を開始します。');
  ensureDir(path.dirname(candidatesPath));
  ensureDir(cacheDir);

  const sources = readJson(sourcesPath, []);
  const existingCandidates = readJson(candidatesPath, []);
  const channelCache = readJson(channelCachePath, {});

  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error('data/sources.json に監視対象が設定されていません。');
  }

  console.log(`[collector] 監視対象チャンネル数: ${sources.length}件`);

  let newCandidatesCount = 0;
  let fetchedEntries = 0;
  const updatedCandidates = [...existingCandidates];
  const errors = [];

  for (const [index, source] of sources.entries()) {
    const normalizedSource = normalizeSource(source);
    try {
      console.log(
        `[collector] (${index + 1}/${sources.length}) ${normalizedSource.name} のchannelIdを取得します`,
      );
      const channelId = await fetchChannelId(normalizedSource, channelCache);
      const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
      const response = await fetch(feedUrl, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!response.ok) {
        throw new Error(`Feed fetch failed (${response.status})`);
      }
      const xml = await response.text();
      const entries = parseEntries(xml).filter((entry) => withinAgeLimit(entry.publishedAt));
      fetchedEntries += entries.length;
      console.log(
        `[collector] ${normalizedSource.name}: ${entries.length}件のエントリを取得（直近${VIDEO_MAX_AGE_DAYS}日以内）`,
      );

      entries.slice(0, NEW_ENTRY_LIMIT).forEach((entry) => {
        const candidateId = `yt-${entry.videoId}`;
        const alreadyExists = updatedCandidates.some((candidate) => candidate.id === candidateId);
        if (alreadyExists) return;

        const topicKey = slugify(entry.title);
        const now = new Date().toISOString();
        updatedCandidates.push({
          id: candidateId,
          source: normalizedSource,
          video: {
            id: entry.videoId,
            title: entry.title,
            url: entry.link,
            description: entry.description,
            publishedAt: entry.publishedAt,
          },
          status: 'pending',
          createdAt: now,
          updatedAt: now,
          topicKey,
          notes: `自動抽出: ${normalizedSource.name} の最新動画から抽出`,
        });
        newCandidatesCount += 1;
        console.log(
          `[collector] 新規候補を追加: ${normalizedSource.name} / ${entry.title} (candidateId: ${candidateId})`,
        );
      });
    } catch (error) {
      console.warn(
        `[collector] ${normalizedSource.name} の処理でエラーが発生しました: ${error.message}`,
      );
      errors.push({
        source: normalizedSource.name,
        message: error.message,
      });
    }
  }

  // Keep candidates sorted by video publish date (desc)
  updatedCandidates.sort((a, b) => {
    const aTime = new Date(a.video?.publishedAt || 0).getTime();
    const bTime = new Date(b.video?.publishedAt || 0).getTime();
    return bTime - aTime;
  });

  writeJson(candidatesPath, updatedCandidates);

  if (errors.length === sources.length) {
    const fatalError = new Error('全てのソース取得に失敗したため collector を中断しました。');
    fatalError.details = errors;
    console.error('[collector] 致命的エラー: 全ソースで取得に失敗しました。');
    throw fatalError;
  }

  if (errors.length > 0) {
    console.log(
      `[collector] 一部のソースでエラーが発生しました（${errors.length}件）。pipeline-status.json を確認してください。`,
    );
  }

  console.log(
    `[collector] 完了: 新規${newCandidatesCount}件 / 総候補${updatedCandidates.length}件（取得エントリ${fetchedEntries}件）`,
  );

  return {
    checkedSources: sources.length,
    fetchedEntries,
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
