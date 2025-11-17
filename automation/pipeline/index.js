#!/usr/bin/env node
/**
 * Pipeline Orchestrator
 * - Runs collector -> researcher -> generator -> publisher sequentially.
 *
 * Stages:
 * 1. Collector: Fetches YouTube videos (status: collected)
 * 2. Researcher: Extracts keywords & searches Google (status: researched)
 * 3. Generator: Generates articles (status: generated)
 * 4. Publisher: Publishes to site (status: published)
 */

const { runCollector } = require('../collector');
const { runResearcher } = require('../researcher');
const { runGenerator } = require('../generator');
const { runPublisher, recordFailureStatus } = require('../publisher');

const main = async () => {
  console.log('[pipeline] 自動記事生成パイプラインを起動します。');
  console.log('[pipeline] 4ステージ構成: Collector → Researcher → Generator → Publisher\n');

  let collectorResult = null;
  let researcherResult = null;
  let generatorResult = null;

  try {
    // Stage 1: Collector (YouTube動画取得)
    console.log('[pipeline] === Stage 1/4: Collector ===');
    collectorResult = await runCollector();
    console.log('[pipeline] Collector 完了:', {
      newCandidates: collectorResult.newCandidates,
      totalCandidates: collectorResult.totalCandidates,
    });

    // Stage 2: Researcher (キーワード抽出 + Google検索)
    console.log('\n[pipeline] === Stage 2/4: Researcher ===');
    researcherResult = await runResearcher();
    console.log('[pipeline] Researcher 完了:', {
      processed: researcherResult.processed,
      succeeded: researcherResult.succeeded,
      failed: researcherResult.failed,
    });

    // Researcherで処理された候補がない場合はGeneratorをスキップ
    if (researcherResult.succeeded === 0) {
      console.log('\n[pipeline] リサーチ済み候補が0件のため、GeneratorとPublisherをスキップします。');
      const status = {
        success: true,
        skipped: true,
        reason: 'no-researched-candidates',
        collector: collectorResult,
        researcher: researcherResult,
      };
      console.log('\n[pipeline] Pipeline completed (skipped).');
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    // Stage 3: Generator (記事生成)
    console.log('\n[pipeline] === Stage 3/4: Generator ===');
    generatorResult = await runGenerator();
    console.log('[pipeline] Generator 完了:', {
      generated: generatorResult.generated,
      reason: generatorResult.reason || 'success',
    });

    // Stage 4: Publisher (公開)
    console.log('\n[pipeline] === Stage 4/4: Publisher ===');
    const status = await runPublisher({
      collectorResult,
      researcherResult,
      generatorResult,
    });

    console.log('\n[pipeline] Pipeline completed successfully.');
    console.log(JSON.stringify(status, null, 2));
  } catch (error) {
    console.error('\n[pipeline] ⚠️  パイプライン内でエラーが発生しました。');
    console.error(`[pipeline] エラー詳細: ${error.message}`);
    recordFailureStatus(error, {
      collector: collectorResult,
      researcher: researcherResult,
      generator: generatorResult,
    });
    throw error;
  }
};

main().catch((error) => {
  console.error('Pipeline failed:', error);
  process.exit(1);
});
