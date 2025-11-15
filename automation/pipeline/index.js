#!/usr/bin/env node
/**
 * Pipeline Orchestrator
 * - Runs collector -> generator -> publisher sequentially.
 */

const { runCollector } = require('../collector');
const { runGenerator } = require('../generator');
const { runPublisher, recordFailureStatus } = require('../publisher');

const main = async () => {
  console.log('[pipeline] 自動記事生成パイプラインを起動します。');
  let collectorResult = null;
  let generatorResult = null;

  try {
    console.log('[pipeline] collector を実行します。');
    collectorResult = await runCollector();
    console.log('[pipeline] collector 完了:', collectorResult);

    console.log('[pipeline] generator を実行します。');
    generatorResult = await runGenerator();
    console.log('[pipeline] generator 完了:', generatorResult);

    console.log('[pipeline] publisher を実行します。');
    const status = await runPublisher({
      collectorResult,
      generatorResult,
    });

    console.log('Pipeline completed.');
    console.log(JSON.stringify(status, null, 2));
  } catch (error) {
    console.error('[pipeline] パイプライン内でエラーが発生しました。');
    recordFailureStatus(error, {
      collector: collectorResult,
      generator: generatorResult,
    });
    throw error;
  }
};

main().catch((error) => {
  console.error('Pipeline failed:', error);
  process.exit(1);
});
