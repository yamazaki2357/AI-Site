const { RESEARCHER } = require('../../config/constants');
const { decodeHtmlEntities } = require('../../lib/text');

const {
  ARTICLE_FETCH_TIMEOUT_MS,
  ARTICLE_TEXT_MAX_LENGTH,
  USER_AGENT,
} = RESEARCHER;

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

const isQualityContent = (text) => {
  if (!text || text.length < 100) {
    return false;
  }

  const japaneseChars = text.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/g);
  const japaneseRatio = japaneseChars ? japaneseChars.length / text.length : 0;
  if (japaneseRatio < 0.3) {
    return false;
  }

  const metaKeywords = ['Copyright', 'Press', 'Privacy Policy', 'Terms', 'NFL Sunday Ticket'];
  const hasMetaKeywords = metaKeywords.some((keyword) => text.includes(keyword));
  if (hasMetaKeywords && text.length < 500) {
    return false;
  }

  return true;
};

module.exports = {
  fetchArticleText,
  isQualityContent,
  normalizePlainText,
};
