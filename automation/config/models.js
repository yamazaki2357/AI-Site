/**
 * モデル設定
 * OpenAI APIのモデルとパラメータを一元管理
 */

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

// キーワード抽出
const KEYWORD_EXTRACTION = {
  model: 'gpt-4o-mini',
  temperature: 0.3,
  max_tokens: 100,
};

// 要約生成
const SUMMARY_GENERATION = {
  model: 'gpt-4o',
  temperature: 0.3,
  max_tokens: 800,
};

// 記事生成
const ARTICLE_GENERATION = {
  model: 'gpt-4o',
  temperature: 0.4,
  response_format: { type: 'json_object' },
};

module.exports = {
  OPENAI_API_URL,
  KEYWORD_EXTRACTION,
  SUMMARY_GENERATION,
  ARTICLE_GENERATION,
};
