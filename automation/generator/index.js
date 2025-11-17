#!/usr/bin/env node
/**
 * Generator
 * - Picks pending candidates from data/candidates.json
 * - Calls OpenAI to research SEO-oriented article outline
 * - Returns article HTML for publisher and records topic history for deduplication
 */

const path = require('path');
const { readJson, writeJson } = require('../lib/io');
const slugify = require('../lib/slugify');

const root = path.resolve(__dirname, '..', '..');
const candidatesPath = path.join(root, 'data', 'candidates.json');
const postsJsonPath = path.join(root, 'data', 'posts.json');
const topicHistoryPath = path.join(root, 'data', 'topic-history.json');
const tagsConfigPath = path.join(root, 'data', 'tags.json');

const API_URL = 'https://api.openai.com/v1/chat/completions';
const DEDUPE_WINDOW_DAYS = 5;

const createChannelUrl = (channelId) =>
  channelId ? `https://www.youtube.com/channel/${channelId}` : '';

const resolveSourceUrl = (source) => {
  if (!source) return '';
  return source.url || createChannelUrl(source.channelId);
};

const toHtmlParagraphs = (text) => {
  if (!text) return '';
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${line}</p>`)
    .join('\n      ');
};

const formatDateParts = (value) => {
  if (!value) {
    const now = new Date();
    return {
      dotted: '',
      verbose: '',
      year: now.getFullYear(),
    };
  }
  const normalized = value.replace(/\//g, '-');
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    return {
      dotted: value,
      verbose: value,
      year: now.getFullYear(),
    };
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return {
    dotted: `${y}.${m}.${d}`,
    verbose: `${y}年${m}月${d}日`,
    year: y,
  };
};

const slugifyHeading = (heading, index = 0) => {
  const base = heading || `section-${index + 1}`;
  const slug = base
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\s・、。/]+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || `section-${index + 1}`;
};

const normalizeTagToken = (value) => {
  if (value === null || value === undefined) return '';
  return value
    .toString()
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
};

const buildTagDictionary = () => {
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

const tagDictionary = buildTagDictionary();

const mapArticleTags = (rawTags) => {
  if (!Array.isArray(rawTags) || rawTags.length === 0) return [];
  const seen = new Set();
  const tags = [];

  rawTags.forEach((tag, idx) => {
    const token = normalizeTagToken(tag);
    if (!token) return;

    const matched = tagDictionary.index.get(token);
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

    const fallbackBase = slugify(tag, 'tag');
    const fallbackSlug =
      seen.has(fallbackBase) || fallbackBase === 'tag'
        ? `${fallbackBase}-${idx + 1}`
        : fallbackBase;
    if (seen.has(fallbackSlug)) return;
    seen.add(fallbackSlug);
    const fallbackLabel = (tag ?? '').toString().trim() || `タグ${idx + 1}`;
    tags.push({
      slug: fallbackSlug,
      label: fallbackLabel,
      category: 'その他',
      style: 'accent-neutral',
    });
  });

  return tags;
};

const compileArticleHtml = (article, meta, options = {}) => {
  const assetBase = typeof options.assetBase === 'string' ? options.assetBase : '../';
  const normalizedAssetBase = assetBase.endsWith('/') ? assetBase : `${assetBase}/`;
  const cssHref = `${normalizedAssetBase}assets/css/style.css`;
  const mainJsSrc = `${normalizedAssetBase}assets/js/main.js`;
  const articleJsSrc = `${normalizedAssetBase}assets/js/article.js`;

  const sections = Array.isArray(article.sections) ? article.sections : [];
  const tags = Array.isArray(article.tags) ? article.tags : [];

  const dateParts = formatDateParts(meta.date);

  const renderTagList = (items) => {
    if (!Array.isArray(items) || items.length === 0) {
      return '';
    }
    const tagItems = items
      .map((tagItem) => {
        if (!tagItem) return '';
        if (typeof tagItem === 'string') {
          const fallbackSlug = slugify(tagItem, 'tag');
          return `<li class="tag" data-tag-slug="${fallbackSlug}">${tagItem}</li>`;
        }
        const label = tagItem.label || tagItem.slug || '';
        if (!label) return '';
        const slugAttr = tagItem.slug ? ` data-tag-slug="${tagItem.slug}"` : '';
        const categoryAttr = tagItem.category ? ` data-tag-category="${tagItem.category}"` : '';
        const styleAttr = tagItem.style ? ` data-tag-style="${tagItem.style}"` : '';
        return `<li class="tag"${slugAttr}${categoryAttr}${styleAttr}>${label}</li>`;
      })
      .filter(Boolean)
      .join('\n          ');
    if (!tagItems) return '';
    return `<ul class="article-tags">
          ${tagItems}
        </ul>`;
  };

  const tagMarkup = renderTagList(tags);

  const renderSubSections = (subSections = [], parentIndex = 0) => {
    if (!Array.isArray(subSections) || subSections.length === 0) {
      return '';
    }
    return subSections
      .map((subSection, childIndex) => {
        const heading = subSection.heading || `ポイント${parentIndex + 1}-${childIndex + 1}`;
        const body = toHtmlParagraphs(subSection.body || subSection.content || '');
        if (!body) return '';
        return `
              <div class="article-subsection">
                <h3 class="subsection-heading">${heading}</h3>
                <div class="subsection-body">
                  ${body}
                </div>
              </div>`;
      })
      .filter(Boolean)
      .join('\n');
  };

  const sectionMarkup = sections
    .map((section, index) => {
      const heading = section.heading ?? `セクション${index + 1}`;
      const slug = slugifyHeading(heading, index);
      const overview = toHtmlParagraphs(section.overview || section.body || '');
      const subSections = renderSubSections(section.subSections, index);
      const overviewMarkup = overview ? `<div class="section-overview">${overview}</div>` : '';
      return `
            <section class="article-section" id="${slug}">
              <h2 class="section-heading">${heading}</h2>
              ${overviewMarkup}
              ${subSections}
            </section>`;
    })
    .join('\n');

  const introMarkup = article.intro
    ? `
        <section class="article-intro-block">
          <div class="intro-content">
${toHtmlParagraphs(article.intro)}
          </div>
        </section>`
    : '';

  const conclusionMarkup = article.conclusion
    ? `
      <section class="article-conclusion inner">
        <h2 class="conclusion-heading">まとめ</h2>
        <div class="conclusion-content">
${toHtmlParagraphs(article.conclusion)}
        </div>
      </section>`
    : '';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${article.title} | AI情報ブログ</title>
  <meta name="description" content="${article.summary ?? ''}">

  <!-- ファビコン -->
  <link rel="icon" type="image/svg+xml" href="${normalizedAssetBase}assets/img/logo.svg">
  <link rel="apple-touch-icon" href="${normalizedAssetBase}assets/img/logo.svg">

  <!-- Open Graph / SNS共有 -->
  <meta property="og:type" content="article">
  <meta property="og:title" content="${article.title} | AI情報ブログ">
  <meta property="og:description" content="${article.summary ?? ''}">
  <meta property="og:image" content="${normalizedAssetBase}assets/img/ogp-default.svg">
  <meta property="og:site_name" content="AI情報ブログ">
  <meta property="og:locale" content="ja_JP">
  <meta property="article:published_time" content="${dateParts.dotted}T00:00:00+09:00">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${article.title} | AI情報ブログ">
  <meta name="twitter:description" content="${article.summary ?? ''}">
  <meta name="twitter:image" content="${normalizedAssetBase}assets/img/ogp-default.svg">

  <link rel="stylesheet" href="${cssHref}">
</head>
<body class="article-page">
  <!-- ヘッダーはcomponents.jsで動的に挿入されます -->

  <main>
    <article class="article-detail">
      <section class="inner article-hero">
        <p class="article-eyebrow">Daily Briefing</p>
        <div class="article-hero-main">
          <p class="post-meta">${dateParts.dotted || meta.date}</p>
          <h1>${article.title}</h1>
          <p class="article-summary">${article.summary ?? ''}</p>
        </div>

        ${tagMarkup}
      </section>

      <div class="inner article-grid">
        <div class="article-main-column">
          <article class="post-article article-content">
${introMarkup}
${sectionMarkup}
          </article>
        </div>

        <aside class="article-sidebar" aria-label="補足情報">
          <section class="article-card article-toc">
            <p class="article-card-label">目次</p>
            <ol class="toc-list" data-toc-list aria-live="polite"></ol>
          </section>
        </aside>
      </div>

      ${conclusionMarkup}
    </article>
  </main>

  <!-- フッターはcomponents.jsで動的に挿入されます -->

  <script src="${normalizedAssetBase}assets/js/components.js"></script>
  <script src="${mainJsSrc}" defer></script>
  <script src="${articleJsSrc}" defer></script>
</body>
</html>`;
};

const parseCompletionContent = (content) => {
  if (!content) {
    throw new Error('OpenAIレスポンスにcontentが含まれていません');
  }
  if (typeof content === 'string') {
    return JSON.parse(content);
  }
  if (Array.isArray(content)) {
    const merged = content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (typeof part?.text === 'string') return part.text;
        return '';
      })
      .join('')
      .trim();
    return JSON.parse(merged);
  }
  throw new Error('contentの形式を解析できませんでした');
};

const extractSearchQuery = (candidate) => {
  // 新しい構造: { original, extracted, method }
  if (candidate.searchQuery && typeof candidate.searchQuery === 'object') {
    return candidate.searchQuery.extracted || candidate.searchQuery.original || '';
  }
  // 旧構造: 文字列
  if (typeof candidate.searchQuery === 'string') {
    return candidate.searchQuery;
  }
  // フォールバック
  return candidate.video?.title || '';
};

const formatSearchSummaries = (summaries) => {
  if (!Array.isArray(summaries) || summaries.length === 0) {
    return '検索要約が取得できていません。';
  }
  return summaries
    .map((item, index) => {
      const title = item.title || `Source ${index + 1}`;
      const url = item.url || 'URLなし';
      const summary = item.summary || item.snippet || '要約なし';
      const snippet = item.snippet ? `\nスニペット: ${item.snippet}` : '';
      return `### ソース${index + 1}\nタイトル: ${title}\nURL: ${url}\n要約: ${summary}${snippet}`;
    })
    .join('\n\n');
};

const requestArticleDraft = async (apiKey, candidate) => {
  const today = new Date().toISOString().split('T')[0];
  const focusText = (candidate.source.focus || []).join(' / ');
  const searchSummary = formatSearchSummaries(candidate.searchSummaries);
  const sourceUrl = resolveSourceUrl(candidate.source);
  const promptSourceUrl = sourceUrl || 'URL不明';
  const searchQuery = extractSearchQuery(candidate);
  const payload = {
    model: 'gpt-4o',
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'あなたは日本語のプロのWebライターです。AI・テクノロジーに関心の高い読者向けの情報ブログで、SEO最適化と専門性を両立させた価値ある記事を執筆します。読者はYouTubeのテック系コンテンツを理解できる程度の技術リテラシーを持っています。丁寧ながらも洗練された口調で、技術的な詳細や実用的な洞察を提供してください。必ず有効なJSONだけを返し、Google検索上位記事から抽出した事実ベースの情報を深く掘り下げ、具体的な洞察を提供します。憶測や水増し表現は避け、記事内でプロンプト設定・システムメッセージ・プロジェクト設定には一切言及しないでください。',
      },
      {
        role: 'user',
        content: `
# 情報源の役割
あなたには以下の2つの情報が提供されます：
1. **Google検索リサーチ要約（SEO上位記事）**: 記事の主要な情報源として使用
2. **YouTube動画メタデータ**: トピック選定やキーワード抽出のきっかけとして参照

**重要**: 記事はGoogle検索上位記事の情報を深く掘り下げて構成してください。YouTube動画は単なる参考情報であり、動画紹介や時系列要約にしてはいけません。

[YouTube動画メタデータ]
- Video Title: ${candidate.video.title}
- Video URL: ${candidate.video.url}
- Published At: ${candidate.video.publishedAt}
- Channel: ${candidate.source.name} (${promptSourceUrl})
- Channel Focus: ${focusText}
- Video Description:
${candidate.video.description}

[Google検索リサーチ要約（SEO上位記事の情報）★メイン情報源★]
検索クエリ: ${searchQuery}

${searchSummary}

# 記事執筆の要件

## ターゲット読者
- **AI・テクノロジーに関心が高く、YouTubeのテック系コンテンツを理解できる層**
- 基本的なIT用語は理解している前提で、より深い技術的洞察を求めている
- 専門用語は適切に使用し、必要に応じて補足説明を加える
- 丁寧ながらも洗練された文体で書く（過度にカジュアルな表現は避ける）

## 記事の目的
読者が技術的な理解を深め、実践的な活用方法や業界動向を把握できる専門性の高い情報を提供すること

## SEO最適化（E-E-A-T重視）
- **Experience（経験）**: 実際の使用例や実践的な情報を含める
- **Expertise（専門性）**: Google検索上位記事の専門的な情報を深掘り
- **Authoritativeness（権威性）**: 信頼できる情報源からの引用
- **Trustworthiness（信頼性）**: 事実ベース、誇張なし
- 検索意図に合致した構成で、主要キーワード・共起語を自然に配置
- タイトル・見出しは検索されやすい表現を使用

## 出力形式
JSON形式で以下のキーを含める: title, summary, intro, sections, conclusion, tags

# 各フィールドの詳細仕様

## title（タイトル）
- **60文字以内**の日本語
- 検索意図を満たし、技術的な価値が伝わる具体的な表現
- 主要キーワードを含める
- 例: 「ChatGPT Plusの実力を検証：有料プランの機能と活用シーン」

## summary（要約）
- **1〜2文**で記事全体を要約
- 「この記事を読むと何がわかるか」を明確に
- 検索ユーザーが求める答えを端的に提示

## intro（導入）
- **2〜3段落、すぐ本題に入る**
- 技術的な背景や業界動向を簡潔に示し、読者の関心を引く
- Google検索上位記事から見える重要なポイントや最新情報を提示
- この記事で得られる具体的な技術的洞察や実践的な価値を明示

## sections（本文セクション）
- **3〜5個のセクション**を、論理的な流れで構成
- プロのWebライターとして最高の記事構成を考え、読者に最大の価値を届ける構造にする

各sectionの構造:
- **heading（H2見出し）**: 検索されやすく、技術的な価値が伝わる表現
- **overview（概要）**: 3〜4文で、このセクションで何を理解できるかを提示
- **subSections（サブセクション）**: 2〜3個
  - **heading（H3見出し）**: 具体的で技術的な小見出し
  - **body（本文）**: 5〜8文程度で詳しく解説
    - Google検索上位記事の情報を深く掘り下げ、技術的な詳細や実用的な洞察を提供
    - 専門用語は適切に使用し、必要に応じて補足説明を加える
    - 「実践的な活用方法」「技術的な制約」「ベストプラクティス」など、より深い情報を含める
    - 具体例を書く場合は、AI生成の架空例ではなく、リサーチ結果に基づく実例のみ使用

## conclusion（まとめ）
- 記事全体の要点を整理し、技術的な意義や今後の展望に触れる
- 読者が次に取るべき**具体的なステップを2〜3個**提案
- 技術的な制約や運用上の注意点も明示する
- 「〜かもしれません」といった曖昧な表現は避け、明確な示唆を提示

## tags（タグ）
- **3〜6個**のキーワード
- SEOに有効な、実際に検索されそうな表現を選ぶ
- 例: "ChatGPT", "AI文章生成", "プロンプト", "生成AI活用"

# トーン・構成・品質の追加条件

## 文字数
- **intro + sections + conclusion で 2,000〜4,000文字**を目安（SEO最適化）
- ただし、水増しは厳禁。意味のある情報だけを含める

## 文体・表現
- 丁寧ながらも洗練された口調（過度にカジュアルな「〜なんです」「〜ですよね」は避ける）
- 「〜といえるでしょう」「〜かもしれません」は使わず、断定的で明確な表現を
- プロのテックライターが書いたような、専門性と読みやすさを両立した文章

## SEOキーワード戦略
- Google検索リサーチの要約に含まれる重要キーワード・共起語を自然に織り込む
- 単なるコピペや機械的羅列ではなく、自分の言葉で再構成
- タイトル・見出し・本文全体にキーワードをバランスよく配置

## 禁止事項
- プロンプト・システムメッセージ・プロジェクト設定への言及
- 読了時間・差別化ポイント・参考文献・補足メモなどのメタ情報セクション
- AI生成の架空例（具体例は1次情報ベースのみ）
- 憶測や根拠のない情報

## その他
- 公開日は ${today} として扱う

# 出力JSONスキーマ例
{
  "title": "...",
  "summary": "...",
  "intro": "...",
  "tags": ["...", "...", "..."],
  "sections": [
    {
      "heading": "...",
      "overview": "...",
      "subSections": [
        { "heading": "...", "body": "..." },
        { "heading": "...", "body": "..." }
      ]
    }
  ],
  "conclusion": "..."
}
`,
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
  return parseCompletionContent(content);
};

const isDuplicateTopic = (topicKey, posts, history) => {
  const now = Date.now();
  const windowMs = DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const cutoff = now - windowMs;

  const inPosts = posts.some((post) => slugify(post.title) === topicKey);
  if (inPosts) return true;

  return history.some((entry) => {
    if (entry.topicKey !== topicKey) return false;
    const last = new Date(entry.lastPublishedAt || entry.firstSeen).getTime();
    return !Number.isNaN(last) && last >= cutoff;
  });
};

const updateTopicHistory = (history, topicKey, record) => {
  const filtered = history.filter((entry) => entry.topicKey !== topicKey);
  const now = new Date().toISOString();
  filtered.push({
    topicKey,
    firstSeen: record.firstSeen || now,
    lastPublishedAt: record.lastPublishedAt || now,
    sourceName: record.sourceName,
    videoTitle: record.videoTitle,
    draftUrl: record.draftUrl,
  });
  return filtered;
};

const runGenerator = async () => {
  console.log('[generator] ステージ開始: 候補の分析を実行します。');
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY が設定されていません。GitHub Secrets に登録してください。');
  }

  const candidates = readJson(candidatesPath, []);
  const posts = readJson(postsJsonPath, []);
  const topicHistory = readJson(topicHistoryPath, []);

  const candidate = candidates.find((item) => item.status === 'researched');
  if (!candidate) {
    console.log('[generator] researched状態の候補が存在しないため処理を終了します。');
    return {
      generated: false,
      reason: 'no-researched-candidates',
    };
  }

  console.log(
    `[generator] 対象候補: ${candidate.id} / ${candidate.source.name} / ${candidate.video?.title}`,
  );
  const sourceUrl = resolveSourceUrl(candidate.source);
  const topicKey = candidate.topicKey || slugify(candidate.video?.title);
  const duplicate = isDuplicateTopic(topicKey, posts, topicHistory);
  console.log(`[generator] 重複判定: ${duplicate ? '重複あり → スキップ' : '新規トピック'}`);

  if (duplicate) {
    const now = new Date().toISOString();
    const updatedCandidates = candidates.map((item) =>
      item.id === candidate.id
        ? {
            ...item,
            status: 'skipped',
            skipReason: 'duplicate-topic',
            updatedAt: now,
          }
        : item,
    );
    writeJson(candidatesPath, updatedCandidates);
    return {
      generated: false,
      reason: 'duplicate-topic',
      candidateId: candidate.id,
    };
  }

  const searchSummaries = Array.isArray(candidate.searchSummaries)
    ? candidate.searchSummaries
    : [];
  if (searchSummaries.length === 0) {
    console.log(
      '[generator] ⚠️ Google検索の上位記事要約がありませんが、動画情報のみで記事生成を試みます。',
    );
  }

  const enrichedCandidate = {
    ...candidate,
    searchSummaries,
  };

  const article = await requestArticleDraft(apiKey, enrichedCandidate);
  console.log(`[generator] OpenAI応答を受信: "${article.title}"`);
  const normalizedTags = mapArticleTags(article.tags);
  const hydratedArticle = {
    ...article,
    tags: normalizedTags,
  };

  const today = new Date().toISOString().split('T')[0];
  const slugifiedTitle = slugify(article.title, topicKey || 'ai-topic');
  const slug = `${today}-${slugifiedTitle}`;
  const fileName = `${slug}.html`;
  const publishRelativePath = path.posix.join('posts', fileName);

  const meta = {
    date: today,
    sourceName: candidate.source.name,
    sourceUrl,
    videoUrl: candidate.video.url,
  };

  const publishHtml = compileArticleHtml(hydratedArticle, meta, { assetBase: '../' });

  const now = new Date().toISOString();

  const updatedCandidates = candidates.map((item) =>
    item.id === candidate.id
      ? {
          ...item,
          status: 'generated',
          generatedAt: now,
          updatedAt: now,
          topicKey,
          postDate: today,
          slug,
          outputFile: publishRelativePath,
        }
      : item,
  );
  writeJson(candidatesPath, updatedCandidates);

  const updatedHistory = updateTopicHistory(topicHistory, topicKey, {
    sourceName: candidate.source.name,
    videoTitle: candidate.video.title,
    draftUrl: publishRelativePath,
    lastPublishedAt: today,
  });
  writeJson(topicHistoryPath, updatedHistory);
  console.log('[generator] candidates と topic-history を更新しました。');

  const postEntry = {
    title: hydratedArticle.title,
    date: today,
    summary: hydratedArticle.summary ?? '',
    tags: normalizedTags,
    url: publishRelativePath,
    slug,
  };

  const articleData = {
    title: hydratedArticle.title,
    summary: hydratedArticle.summary ?? '',
    intro: hydratedArticle.intro ?? '',
    conclusion: hydratedArticle.conclusion ?? '',
    tags: normalizedTags,
    sections: Array.isArray(hydratedArticle.sections) ? hydratedArticle.sections : [],
    slug,
    date: today,
    htmlContent: publishHtml,
    relativePath: publishRelativePath,
    source: {
      name: candidate.source.name,
      url: sourceUrl,
    },
    video: {
      title: candidate.video.title,
      url: candidate.video.url,
    },
    searchSummaries,
  };

  console.log(
    `[generator] 記事データを返却: slug=${slug}, ファイル予定パス=${publishRelativePath}`,
  );

  return {
    generated: true,
    candidateId: candidate.id,
    postEntry,
    draftUrl: publishRelativePath,
    topicKey,
    article: articleData,
  };
};

if (require.main === module) {
  runGenerator()
    .then((result) => {
      console.log('Generator finished:', result);
    })
    .catch((error) => {
      console.error('Generator failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runGenerator,
};
