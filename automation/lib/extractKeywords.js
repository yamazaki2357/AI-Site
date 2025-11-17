/**
 * OpenAI APIを使用して、YouTube動画のタイトルと説明文から
 * Google検索に適した簡潔なキーワードを抽出する
 */

const API_URL = 'https://api.openai.com/v1/chat/completions';

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
    model: 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content:
          'あなたはSEO専門家です。YouTube動画のタイトルと説明文から、Google検索に最適な簡潔なキーワードを抽出してください。不要な助詞や「〜しましょう」「〜です」などの表現は除去し、核となる技術用語・製品名・サービス名のみを抽出してください。',
      },
      {
        role: 'user',
        content: `以下のYouTube動画から、Google検索に適した簡潔なキーワード（20文字以内）を抽出してください。

タイトル: ${title}
説明文: ${description.slice(0, 500)}

要件:
- 核となる技術用語・製品名・サービス名のみを抽出
- 「〜しましょう」「〜です」「〜とは」などの不要な表現は除去
- 複数のキーワードがある場合はスペースで区切る
- 20文字以内に収める
- 日本語で出力

例:
入力: 「ChatGPT Plusの新機能を試してみましょう！」
出力: 「ChatGPT Plus 新機能」

入力: 「Gemini 2.0がついにリリース！性能を徹底比較」
出力: 「Gemini 2.0 性能比較」

キーワードのみを出力してください（説明や前置きは不要）:`,
      },
    ],
  };

  const response = await fetch(API_URL, {
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
