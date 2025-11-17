/**
 * OpenAI APIを使用して、YouTube動画のタイトルと説明文から
 * Google検索に適した簡潔なキーワードを抽出する
 */

const { KEYWORD_EXTRACTION } = require('../config/models');
const PROMPTS = require('../config/prompts');
const { callOpenAI, extractContent } = require('./openai');

/**
 * 動画タイトルと説明文からGoogle検索用のキーワードを抽出
 * @param {string} apiKey - OpenAI API Key
 * @param {string} title - YouTube動画のタイトル
 * @param {string} description - YouTube動画の説明文
 * @returns {Promise<string>} 抽出されたキーワード
 */
const extractSearchKeywords = async (apiKey, title, description = '') => {
  if (!title) {
    throw new Error('タイトルが指定されていません');
  }

  const messages = [
    {
      role: 'system',
      content: PROMPTS.KEYWORD_EXTRACTION.system,
    },
    {
      role: 'user',
      content: PROMPTS.KEYWORD_EXTRACTION.user(title, description),
    },
  ];

  const completion = await callOpenAI({
    apiKey,
    messages,
    model: KEYWORD_EXTRACTION.model,
    temperature: KEYWORD_EXTRACTION.temperature,
    maxTokens: KEYWORD_EXTRACTION.max_tokens,
  });

  return extractContent(completion);
};

module.exports = {
  extractSearchKeywords,
};
