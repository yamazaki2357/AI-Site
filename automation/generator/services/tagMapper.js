const slugify = require('../../lib/slugify');
const { normalizeTagToken } = require('./tokenUtils');

const buildTagDictionary = (readJson, tagsConfigPath) => {
  const raw = readJson(tagsConfigPath, []);
  const entries = Array.isArray(raw) ? raw : [];
  const index = new Map();

  const registerToken = (token, entry) => {
    if (!token || index.has(token)) return;
    index.set(token, entry);
  };

  entries.forEach((item) => {
    if (!item || !item.slug) return;
    const normalizedEntry = {
      slug: item.slug,
      label: item.label || item.slug,
      category: item.category || 'その他',
      style: item.style || null,
    };
    registerToken(normalizeTagToken(item.slug), normalizedEntry);
    registerToken(normalizeTagToken(item.label), normalizedEntry);
    if (Array.isArray(item.aliases)) {
      item.aliases.forEach((alias) => registerToken(normalizeTagToken(alias), normalizedEntry));
    }
  });

  return { entries, index };
};

const createTagMapper = ({ readJson, tagsConfigPath }) => {
  let tagDictionary = null;
  const ensureDictionary = () => {
    if (!tagDictionary) {
      tagDictionary = buildTagDictionary(readJson, tagsConfigPath);
    }
    return tagDictionary;
  };

  const mapArticleTags = (rawTags) => {
    if (!Array.isArray(rawTags) || rawTags.length === 0) return [];
    const seen = new Set();
    const tags = [];
    const dictionary = ensureDictionary();

    rawTags.forEach((tag, idx) => {
      const token = normalizeTagToken(tag);
      if (!token) return;

      const matched = dictionary.index.get(token);
      if (matched) {
        if (seen.has(matched.slug)) return;
        seen.add(matched.slug);
        tags.push({
          slug: matched.slug,
          label: matched.label || matched.slug,
          category: matched.category || 'その他',
          style: matched.style || null,
        });
        return;
      }

      const originalLabel = (tag ?? '').toString().trim();
      if (!originalLabel) return;

      const fallbackBase = slugify(originalLabel, 'tag');
      let fallbackSlug = fallbackBase;

      if (fallbackBase === 'tag' || seen.has(fallbackBase)) {
        const sanitizedLabel = originalLabel
          .normalize('NFKC')
          .toLowerCase()
          .replace(/\s+/g, '-')
          .replace(/[^a-z0-9\-]/g, '')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        fallbackSlug = sanitizedLabel || `tag-${idx + 1}`;

        let counter = 1;
        let candidateSlug = fallbackSlug;
        while (seen.has(candidateSlug)) {
          candidateSlug = `${fallbackSlug}-${counter}`;
          counter += 1;
        }
        fallbackSlug = candidateSlug;
      }

      if (seen.has(fallbackSlug)) return;
      seen.add(fallbackSlug);

      tags.push({
        slug: fallbackSlug,
        label: originalLabel || `タグ${idx + 1}`,
        category: 'その他',
        style: 'accent-neutral',
      });
    });

    return tags;
  };

  return { mapArticleTags };
};

module.exports = {
  createTagMapper,
};
