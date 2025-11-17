/**
 * OpenAI APIを使用して、YouTube動画のタイトルと説明文から
 * Google検索に適した簡潔なキーワードを抽出する
 */

const { OPENAI_API_URL } = require('../config/models');
const { KEYWORD_EXTRACTION } = require('../config/models');
const PROMPTS = require('../config/prompts');

/**
 * 動画タイトルと説明文からGoogle検索用のキーワードを抽出
 * @param {string} apiKey - OpenAI API Key
 * @param {string} title - YouTube動画のタイトル
 * @param {string} description - YouTube動画の説明文
 * @returns {Promise<string>} 抽出されたキーワード
 */
const extractSearchKeywords = async (apiKey, title, description = '') => {
  if (!apiKey) {
    throw new Error('OpenAI API Keyが設定されていません');
  }
  if (!title) {
    throw new Error('タイトルが指定されていません');
  }

  const payload = {
    model: KEYWORD_EXTRACTION.model,
    temperature: KEYWORD_EXTRACTION.temperature,
    max_tokens: KEYWORD_EXTRACTION.max_tokens,
    messages: [
      {
        role: 'system',
        content: PROMPTS.KEYWORD_EXTRACTION.system,
      },
      {
        role: 'user',
        content: PROMPTS.KEYWORD_EXTRACTION.user(title, description),
      },
    ],
  };

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
  }

  const completion = await response.json();
  const content = completion?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('OpenAIレスポンスにcontentが含まれていません');
  }

  // 抽出されたキーワードをトリミングして返す
  return content.trim();
};

module.exports = {
  extractSearchKeywords,
};
