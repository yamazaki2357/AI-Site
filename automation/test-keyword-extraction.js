#!/usr/bin/env node
/**
 * キーワード抽出機能のテスト
 */

const { extractSearchKeywords } = require('./lib/extractKeywords');

const testCases = [
  {
    title: 'Sherlock Dash AlphaとSherlock Think Alphaをテストしましょう！',
    description: 'https://www.twitch.tv/technavi_tooru https://x.com/technavi_tooru',
  },
  {
    title: 'ChatGPT Plusの新機能を試してみた！これはすごい',
    description: '今回はChatGPT Plusの最新機能について解説します',
  },
  {
    title: 'Gemini 2.0がついにリリース！性能を徹底比較してみた結果',
    description: 'GoogleのGemini 2.0がリリースされました。従来モデルとの比較を行います。',
  },
];

const main = async () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('OPENAI_API_KEY が設定されていません');
    process.exit(1);
  }

  console.log('=== キーワード抽出テスト ===\n');

  for (const testCase of testCases) {
    console.log(`元のタイトル: ${testCase.title}`);
    try {
      const keywords = await extractSearchKeywords(apiKey, testCase.title, testCase.description);
      console.log(`抽出キーワード: ${keywords}`);
      console.log(`文字数: ${keywords.length}文字\n`);
    } catch (error) {
      console.error(`エラー: ${error.message}\n`);
    }
  }
};

main().catch(console.error);
