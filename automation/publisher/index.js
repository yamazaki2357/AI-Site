#!/usr/bin/env node
/**
 * Publisher
 * - Updates data/posts.json with generator output.
 * - Writes automation/output/pipeline-status.json for UI consumption.
 */

const fs = require('fs');
const path = require('path');
const { readJson, writeJson, ensureDir } = require('../lib/io');
const { VALIDATION } = require('../config/constants');
const { findOrphanPosts } = require('../lib/postValidation');

const root = path.resolve(__dirname, '..', '..');
const postsDir = path.join(root, 'posts');
const postsJsonPath = path.join(root, 'data', 'posts.json');
const statusPath = path.join(root, 'automation', 'output', 'pipeline-status.json');

const parseDateValue = (value, fallbackDate) => {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  if (fallbackDate) {
    const parsed = new Date(`${fallbackDate}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  return 0;
};

const updatePosts = (posts, newEntry) => {
  const list = Array.isArray(posts) ? [...posts] : [];
  if (!newEntry) return list;
  const normalizedEntry = {
    ...newEntry,
    publishedAt: newEntry.publishedAt || new Date().toISOString(),
  };
  const filtered = list.filter((post) => post.url !== normalizedEntry.url);
  filtered.push(normalizedEntry);
  filtered.sort((a, b) => {
    const bTime = parseDateValue(b.publishedAt, b.date);
    const aTime = parseDateValue(a.publishedAt, a.date);
    if (bTime !== aTime) return bTime - aTime;
    const bDate = new Date(b.date);
    const aDate = new Date(a.date);
    if (!Number.isNaN(bDate) && !Number.isNaN(aDate) && bDate.getTime() !== aDate.getTime()) {
      return bDate - aDate;
    }
    return (b.slug || b.url || '').localeCompare(a.slug || a.url || '', undefined, {
      sensitivity: 'base',
      numeric: true,
    });
  });
  return filtered;
};

const writeStatusSnapshot = (payload) => {
  ensureDir(path.dirname(statusPath));
  writeJson(statusPath, payload);
  console.log('[publisher] pipeline-status.json を更新しました。');
  return payload;
};

const recordFailureStatus = (error, context = {}) => {
  const payload = {
    status: 'failure',
    generatedFile: null,
    executedAt: new Date().toISOString(),
    error: {
      message: error.message,
      stack: (error.stack || '').split('\n').slice(0, 8).join('\n'),
    },
    ...context,
  };
  return writeStatusSnapshot(payload);
};

const runPublisher = async ({ collectorResult, researcherResult, generatorResult }) => {
  console.log('[publisher] ステージ開始: 記事ファイルとサマリーを更新します。');
  ensureDir(postsDir);

  const posts = readJson(postsJsonPath, []);
  let updatedPosts = posts;
  let generatedFilePath = null;
  let postsChanged = false;

  if (generatorResult?.generated && generatorResult.article?.htmlContent) {
    const article = generatorResult.article;
    const relativePath =
      article.relativePath || path.posix.join('posts', `${article.slug ?? 'draft'}.html`);
    const absolutePath = path.join(root, relativePath);
    ensureDir(path.dirname(absolutePath));

    const nextHtml = article.htmlContent;
    const currentHtml = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf-8') : null;
    if (currentHtml !== nextHtml) {
      fs.writeFileSync(absolutePath, nextHtml);
      console.log(`[publisher] 記事ファイルを書き込みました: ${relativePath}`);
    } else {
      console.log(`[publisher] 既存コンテンツと同一のため書き込みをスキップ: ${relativePath}`);
    }

    generatedFilePath = relativePath;
    const basePostEntry =
      generatorResult.postEntry || {
        title: article.title,
        date: article.date,
        summary: article.summary ?? '',
        tags: Array.isArray(article.tags) ? article.tags : [],
      };
    const finalizedPostEntry = {
      ...basePostEntry,
      url: relativePath,
      slug: basePostEntry.slug || article.slug,
      image: basePostEntry.image || article.image || null,
    };
    updatedPosts = updatePosts(posts, finalizedPostEntry);
    postsChanged = JSON.stringify(updatedPosts) !== JSON.stringify(posts);
    if (postsChanged) {
      writeJson(postsJsonPath, updatedPosts);
      console.log(`[publisher] data/posts.json を更新しました（${updatedPosts.length}件）。`);
    } else {
      console.log('[publisher] data/posts.json に変化はありませんでした。');
    }
  } else {
    console.log('[publisher] generator出力が無いため、記事作成とposts.json更新をスキップします。');
  }

  const validationWarnings = [];
  if (VALIDATION?.ORPHAN_POST_CHECK_ENABLED) {
    try {
      const orphanPosts = await findOrphanPosts();
      if (orphanPosts.length > 0) {
        const missing = orphanPosts.map((entry) => entry.url);
        validationWarnings.push({
          type: 'orphan-posts',
          message: 'posts/ ディレクトリ内に data/posts.json へ登録されていない記事があります。',
          files: missing,
        });
        console.warn(
          '[publisher] ⚠️  data/posts.json 未登録の記事ファイルを検出しました:',
          missing.join(', '),
        );
      }
    } catch (error) {
      validationWarnings.push({
        type: 'orphan-posts',
        message: `孤立記事チェックに失敗しました: ${error.message}`,
      });
      console.warn('[publisher] ⚠️  孤立記事チェックに失敗しました:', error.message);
    }
  }

  const status = {
    status: generatedFilePath ? 'success' : 'skipped',
    generatedFile: generatedFilePath,
    executedAt: new Date().toISOString(),
    collector: collectorResult ?? null,
    researcher: researcherResult ?? null,
    generator: generatorResult ?? null,
    publisher: {
      addedPost: postsChanged,
      totalPosts: updatedPosts.length,
      outputFile: generatedFilePath,
    },
  };
  if (validationWarnings.length > 0) {
    status.validation = {
      warnings: validationWarnings,
    };
  }

  return writeStatusSnapshot(status);
};

if (require.main === module) {
  runPublisher({})
    .then((status) => {
      console.log('Publisher finished:', status);
    })
    .catch((error) => {
      console.error('Publisher failed:', error);
      recordFailureStatus(error);
      process.exit(1);
    });
}

module.exports = {
  runPublisher,
  recordFailureStatus,
};
