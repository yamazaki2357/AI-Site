const { RESEARCHER } = require('../../config/constants');
const { SUMMARY_GENERATION } = require('../../config/models');
const PROMPTS = require('../../config/prompts');
const { callOpenAI, extractContent } = require('../../lib/openai');
const { fetchArticleText, isQualityContent } = require('./articleContent');

const { SUMMARY_MIN_LENGTH, SUMMARY_MAX_LENGTH } = RESEARCHER;

const generateAISummary = async (articleText, title, apiKey) => {
  if (!articleText || articleText.length < 200) {
    return '';
  }

  try {
    const messages = [
      {
        role: 'system',
        content: PROMPTS.SUMMARY_GENERATION.system,
      },
      {
        role: 'user',
        content: PROMPTS.SUMMARY_GENERATION.user(title, articleText),
      },
    ];

    const completion = await callOpenAI({
      apiKey,
      messages,
      model: SUMMARY_GENERATION.model,
      temperature: SUMMARY_GENERATION.temperature,
      maxTokens: SUMMARY_GENERATION.max_tokens,
    });

    const summary = extractContent(completion);
    if (summary.length >= SUMMARY_MIN_LENGTH) {
      return summary;
    }
  } catch (error) {
    console.warn(`[researcher] AI要約生成に失敗: ${error.message}`);
  }

  return '';
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
    summary = source.slice(
      0,
      Math.max(SUMMARY_MIN_LENGTH, Math.min(SUMMARY_MAX_LENGTH, source.length)),
    );
  }

  if (summary.length < SUMMARY_MIN_LENGTH && fallbackText && source !== fallbackText) {
    const combined = `${summary} ${fallbackText}`.trim();
    summary = combined.slice(
      0,
      Math.max(SUMMARY_MIN_LENGTH, Math.min(SUMMARY_MAX_LENGTH, combined.length)),
    );
  }

  if (summary.length > SUMMARY_MAX_LENGTH) {
    summary = summary.slice(0, SUMMARY_MAX_LENGTH);
  }

  return summary.trim();
};

const summarizeSearchResult = async (item, index, apiKey) => {
  const title = item.title || `検索結果${index + 1}`;
  const url = item.link;
  const snippet = item.snippet || '';
  let bodyText = '';

  if (url) {
    bodyText = await fetchArticleText(url);
  }

  if (!isQualityContent(bodyText)) {
    console.warn(`[researcher] 低品質コンテンツをスキップ: ${url} (日本語率が低いか、メタデータが多い)`);
    return {
      title,
      url,
      snippet,
      summary: snippet,
      quality: 'low',
    };
  }

  let summary = '';
  if (bodyText && bodyText.length >= 200 && apiKey) {
    summary = await generateAISummary(bodyText, title, apiKey);
  }

  if (!summary || summary.length < SUMMARY_MIN_LENGTH) {
    summary = buildSummaryWithinRange(bodyText, snippet);
  }

  return {
    title,
    url,
    snippet,
    summary,
    quality: 'high',
  };
};

module.exports = {
  generateAISummary,
  buildSummaryWithinRange,
  summarizeSearchResult,
};
