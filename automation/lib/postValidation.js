const fs = require('fs/promises');
const path = require('path');
const { VALIDATION } = require('../config/constants');

const root = path.resolve(__dirname, '..', '..');
const postsDir = path.join(root, 'posts');
const postsJsonPath = path.join(root, 'data', 'posts.json');

const normalizePath = (value) => {
  if (!value) return null;
  return value.replace(/^[./]+/, '').replace(/\\/g, '/');
};

const readPostsDirectory = async () => {
  const entries = await fs.readdir(postsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
    .map((entry) => entry.name);
};

const readPostsJson = async () => {
  try {
    const content = await fs.readFile(postsJsonPath, 'utf-8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
};

const buildKnownUrls = (posts) => {
  const urls = new Set();
  posts.forEach((post) => {
    const normalizedUrl = normalizePath(post?.url);
    if (normalizedUrl) {
      urls.add(normalizedUrl);
      return;
    }
    if (post?.slug) {
      urls.add(`posts/${post.slug}.html`);
    }
  });
  return urls;
};

const findOrphanPosts = async () => {
  const enabled = VALIDATION?.ORPHAN_POST_CHECK_ENABLED;
  if (!enabled) return [];
  const ignoreList = Array.isArray(VALIDATION?.ORPHAN_POST_IGNORE)
    ? VALIDATION.ORPHAN_POST_IGNORE
    : [];
  const ignores = new Set(ignoreList);
  const htmlFiles = await readPostsDirectory();
  const posts = await readPostsJson();
  const knownUrls = buildKnownUrls(posts);

  return htmlFiles
    .filter((name) => !ignores.has(name))
    .map((name) => ({
      filename: name,
      url: normalizePath(path.posix.join('posts', name)),
    }))
    .filter((entry) => !knownUrls.has(entry.url));
};

module.exports = {
  findOrphanPosts,
};
