const { normalizeTagToken } = require('./tokenUtils');

const deterministicPickFromPool = (pool, seed = '') => {
  if (!Array.isArray(pool) || pool.length === 0) return null;
  const normalizedSeed = seed ? seed.toString() : 'ai-info-blog';
  let hash = 0;
  for (let i = 0; i < normalizedSeed.length; i += 1) {
    hash = (hash * 31 + normalizedSeed.charCodeAt(i)) & 0xffffffff;
  }
  const index = Math.abs(hash) % pool.length;
  return pool[index];
};

const buildArticleImagePool = (readJson, manifestPath) => {
  const manifest = readJson(manifestPath, []);
  if (!Array.isArray(manifest)) return [];
  return manifest
    .map((item, index) => {
      if (!item || !item.key || !item.src) return null;
      const topics = Array.isArray(item.topics)
        ? item.topics.map((topic) => normalizeTagToken(topic)).filter(Boolean)
        : [];
      return {
        key: item.key,
        src: item.src,
        alt: item.alt || item.label || 'AI情報ブログのビジュアル',
        label: item.label || null,
        description: item.description || null,
        category: normalizeTagToken(item.category) || null,
        topics,
        isDefault: Boolean(item.isDefault) || index === 0,
      };
    })
    .filter(Boolean);
};

const gatherImageTokens = (article, candidate) => {
  const tokens = new Set();
  const pushToken = (value) => {
    const normalized = normalizeTagToken(value);
    if (normalized) tokens.add(normalized);
  };

  if (article?.tags) {
    article.tags.forEach((tag) => {
      if (!tag) return;
      if (typeof tag === 'string') {
        pushToken(tag);
        return;
      }
      pushToken(tag.slug);
      pushToken(tag.label);
      pushToken(tag.category);
    });
  }

  if (candidate?.source?.focus) {
    candidate.source.focus.forEach(pushToken);
  }

  if (candidate?.topicKey) {
    pushToken(candidate.topicKey);
    candidate.topicKey.split(/[-_]+/).forEach(pushToken);
  }

  if (article?.slug) {
    pushToken(article.slug);
    article.slug.split(/[-_]+/).forEach(pushToken);
  }

  const injectFromTitle = (title) => {
    if (!title) return;
    title
      .split(/[\s・／/、。:+\-]+/)
      .map((token) => token.trim())
      .forEach(pushToken);
  };

  injectFromTitle(article?.title);
  injectFromTitle(candidate?.video?.title);

  return tokens;
};

const createImageSelector = ({ readJson, manifestPath }) => {
  const articleImagePool = buildArticleImagePool(readJson, manifestPath);
  const defaultArticleImage =
    articleImagePool.find((item) => item.isDefault) || articleImagePool[0] || null;

  const selectArticleImage = (article, candidate) => {
    if (!articleImagePool.length) return null;
    const tokens = gatherImageTokens(article, candidate);
    const matched = articleImagePool.filter((entry) => {
      if (!entry) return false;
      if (entry.topics.some((topic) => tokens.has(topic))) return true;
      if (entry.category && tokens.has(entry.category)) return true;
      return false;
    });
    const seed =
      candidate?.topicKey || article?.slug || article?.title || candidate?.id || 'ai-info';
    const pool = matched.length > 0 ? matched : articleImagePool;
    const picked = deterministicPickFromPool(pool, seed) || defaultArticleImage;
    if (!picked) return null;
    return {
      key: picked.key,
      src: picked.src,
      alt: picked.alt,
      label: picked.label,
      caption: picked.description || picked.label || '',
      category: picked.category,
    };
  };

  return { selectArticleImage };
};

module.exports = {
  createImageSelector,
};
