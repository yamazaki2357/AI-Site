#!/usr/bin/env node
/**
 * @fileoverview パイプラインオーケストレーター
 * キーワードベースの記事生成パイプライン
 *
 * 処理フロー:
 * 1. keywords.json から検索キーワードを読み込み (またはCLI引数)
 * 2. Researcher: Google検索による調査（検索1回、要約3件）
 * 3. Generator: 記事を生成
 * 4. Publisher: 生成された記事をサイトに公開
 *
 * 重要な設計方針:
 * - 各ステージは1回のみ実行されます。リトライや再試行はしません。
 * - エラーが発生した場合は、フォールバック値を使用するか、gracefulに失敗します。
 * - 無限ループを防ぐため、どのステージでも再検索や再生成は行いません。
 */

const path = require('path');
const { parseArgs } = require('util');
const { readJson } = require('../lib/io');
// const { runCollector } = require('../collector'); // Collector は一時的にスキップ
const { runResearcher } = require('../researcher');
const { runGenerator } = require('../generator');
const { runPublisher, recordFailureStatus } = require('../publisher');

// --- パス設定 ---
const root = path.resolve(__dirname, '..', '..');
const keywordsPath = path.join(root, 'data', 'keywords.json');

/**
 * keywords.json から検索キーワードを読み込みます。
 * @returns {string} 検索キーワード
 */
const loadKeyword = () => {
  try {
    const keywords = readJson(keywordsPath, []);
    if (!Array.isArray(keywords) || keywords.length === 0) {
      throw new Error('keywords.json にキーワードが設定されていません。');
    }
    // 配列の最初の要素をキーワードとして使用
    const keyword = keywords[0];
    if (!keyword || typeof keyword !== 'string') {
      throw new Error('keywords.json の最初の要素が有効な文字列ではありません。');
    }
    return keyword;
  } catch (error) {
    throw new Error(`keywords.json の読み込みに失敗しました: ${error.message}`);
  }
};

/**
 * メインのパイプライン処理
 */
const main = async () => {
  // CLI引数のパース
  const options = {
    keyword: {
      type: 'string',
      short: 'k',
    },
    stages: {
      type: 'string',
      short: 's',
    },
  };

  let args;
  try {
    const parsed = parseArgs({ options, strict: false });
    args = parsed.values;
  } catch (e) {
    // Node.jsのバージョンによっては parseArgs が利用できない場合や
    // オプションが異なる場合のフォールバック (簡易実装)
    args = {};
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--keyword' || argv[i] === '-k') args.keyword = argv[i + 1];
      if (argv[i] === '--stages' || argv[i] === '-s') args.stages = argv[i + 1];
    }
  }

  console.log('[pipeline] 自動記事生成パイプラインを起動します。');
  console.log('[pipeline] 処理フロー: Keyword → Researcher → Generator → Publisher\n');

  // 各ステージの結果を格納する変数
  let collectorResult = null; // Collector はスキップするが、Publisher の互換性のため
  let researcherResult = null;
  let generatorResult = null;

  try {
    // Stage 0: キーワード決定
    console.log('[pipeline] === Stage 0: Keyword Loading ===');
    let keyword;
    if (args.keyword) {
      keyword = args.keyword;
      console.log(`[pipeline] CLI引数からキーワードを使用: "${keyword}"`);
    } else {
      keyword = loadKeyword();
      console.log(`[pipeline] keywords.jsonからキーワードを使用: "${keyword}"`);
    }

    // Stage 1: Collector (一時的にスキップ)
    // console.log('\n[pipeline] === Stage 1/4: Collector ===');
    // collectorResult = await runCollector();
    // console.log('[pipeline] Collector 完了:', {
    //   newCandidates: collectorResult.newCandidates,
    //   totalCandidates: collectorResult.totalCandidates,
    // });
    console.log('\n[pipeline] === Stage 1: Collector (スキップ) ===');
    collectorResult = {
      skipped: true,
      reason: 'keyword-based-pipeline',
    };

    // Stage 2: Researcher (キーワードでGoogle検索)
    console.log('\n[pipeline] === Stage 2: Researcher ===');
    researcherResult = await runResearcher({ keyword });
    console.log('[pipeline] Researcher 完了:', {
      keyword: researcherResult.keyword,
      summariesCount: researcherResult.summaries.length,
    });

    // Researcherで要約が取得できなかった場合は、後続のステージをスキップ
    if (researcherResult.summaries.length === 0) {
      console.log('\n[pipeline] 要約が0件のため、GeneratorとPublisherをスキップします。');
      generatorResult = {
        generated: false,
        reason: 'no-summaries',
      };
      // Publisherを呼び出して最終的なステータスを記録
      const status = await runPublisher({
        collectorResult,
        researcherResult,
        generatorResult,
      });
      console.log('\n[pipeline] Pipeline completed (skipped).');
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    // Stage 3: Generator (記事生成)
    console.log('\n[pipeline] === Stage 3: Generator ===');
    generatorResult = await runGenerator(researcherResult);
    console.log('[pipeline] Generator 完了:', {
      generated: generatorResult.generated,
      reason: generatorResult.reason || 'success',
    });

    // Stage 4: Publisher (公開)
    console.log('\n[pipeline] === Stage 4: Publisher ===');
    const status = await runPublisher({
      collectorResult,
      researcherResult,
      generatorResult,
    });

    console.log('\n[pipeline] Pipeline completed successfully.');
    console.log(JSON.stringify(status, null, 2));
  } catch (error) {
    // パイプラインのいずれかのステージでエラーが発生した場合
    console.error('\n[pipeline] ⚠️  パイプライン内でエラーが発生しました。');
    console.error(`[pipeline] エラー詳細: ${error.message}`);
    // 失敗ステータスを記録
    recordFailureStatus(error, {
      collector: collectorResult,
      researcher: researcherResult,
      generator: generatorResult,
    });
    throw error; // エラーを再スローしてプロセスを異常終了させる
  }
};

// スクリプトが直接実行された場合にmain関数を呼び出す
main().catch((error) => {
  console.error('Pipeline failed:', error);
  process.exit(1);
});
