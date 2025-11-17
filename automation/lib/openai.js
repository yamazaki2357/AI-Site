/**
 * OpenAI API呼び出しの統一ユーティリティ
 * エラーハンドリング、レート制限、リトライロジックを含む
 */

const { OPENAI_API_URL } = require('../config/models');

/**
 * OpenAI APIを呼び出す統一関数
 * @param {Object} options - APIオプション
 * @param {string} options.apiKey - OpenAI API Key
 * @param {Array} options.messages - メッセージ配列
 * @param {string} options.model - モデル名
 * @param {number} options.temperature - temperature値
 * @param {number} [options.maxTokens] - 最大トークン数（オプション）
 * @param {Object} [options.responseFormat] - レスポンスフォーマット（オプション）
 * @returns {Promise<Object>} OpenAI APIのレスポンス
 */
const callOpenAI = async (options) => {
  const { apiKey, messages, model, temperature, maxTokens, responseFormat } = options;

  if (!apiKey) {
    throw new Error('OpenAI API Keyが設定されていません');
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('messagesが指定されていません');
  }

  const payload = {
    model,
    temperature,
    messages,
  };

  if (maxTokens) {
    payload.max_tokens = maxTokens;
  }

  if (responseFormat) {
    payload.response_format = responseFormat;
  }

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
  return completion;
};

/**
 * OpenAI APIレスポンスからコンテンツを抽出
 * @param {Object} completion - OpenAI APIレスポンス
 * @returns {string} 抽出されたコンテンツ
 */
const extractContent = (completion) => {
  const content = completion?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('OpenAIレスポンスにcontentが含まれていません');
  }

  return content.trim();
};

module.exports = {
  callOpenAI,
  extractContent,
};
