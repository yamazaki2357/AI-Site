/**
 * @fileoverview テンプレートレンダリングサービス
 *
 * 記事データとHTMLテンプレートを組み合わせて、最終的な記事HTMLファイルを生成する機能を提供します。
 *
 * 【主な機能】
 *
 * 1. テンプレートの読み込みとキャッシング
 *    - `automation/templates/article.html` を読み込み、メモリにキャッシュ
 *    - 2回目以降の呼び出しではキャッシュから取得し、高速化
 *
 * 2. プレースホルダーの置換
 *    - テンプレート内の `{{TITLE}}`, `{{SUMMARY}}` などのプレースホルダーを実際の値に置換
 *    - 記事タイトル、概要、日付、タグ、セクションなどを動的に埋め込み
 *
 * 3. HTMLマークアップの生成
 *    - タグリスト: 記事に紐づくタグを色分けされたタグ要素として生成
 *    - セクション: H2見出しと本文、サブセクション（H3）を階層的にマークアップ
 *    - メタ情報: 公開日、ソース情報、参照動画のカードを生成
 *    - 共有リンク: X（Twitter）、LinkedIn、ネイティブ共有ボタンを生成
 *
 * 4. フォールバック処理
 *    - テンプレートファイルの読み込みに失敗した場合、最小限のHTMLを自動生成
 *
 * 【処理の流れ】
 * 入力: 記事データ（タイトル、セクション、タグなど）
 *   ↓
 * 各パーツをHTMLに変換
 *   ↓
 * テンプレートのプレースホルダーに埋め込み
 *   ↓
 * 出力: 完成した記事HTMLファイル
 */

const fs = require('fs');
const slugify = require('../../lib/slugify');

/**
 * 正規表現で使用される特殊文字をエスケープします。
 *
 * 正規表現のメタ文字（例: `$`, `*`, `+`, `?`, `.`, `[`, `]`など）を、
 * リテラル文字として扱うために、バックスラッシュでエスケープします。
 *
 * これにより、テンプレート内のプレースホルダー（例: `{{TITLE}}`）を安全に検索・置換できます。
 * もしエスケープしないと、`{{TITLE}}`の中の `.` や `()` が正規表現として解釈されてしまいます。
 *
 * @param {string} value - エスケープする文字列
 * @returns {string} エスケープされた文字列
 *
 * @example
 * escapeRegExp('{{TITLE}}')  // => '\\{\\{TITLE\\}\\}'
 * escapeRegExp('price: $10') // => 'price: \\$10'
 */
const escapeRegExp = (value) => value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

/**
 * プレーンテキストをHTMLの段落（<p>タグ）に変換します。
 *
 * この関数は、OpenAI APIから返された改行を含むテキストを、
 * HTMLの段落として適切にマークアップする役割を持ちます。
 *
 * 【処理の流れ】
 * 1. 1つ以上の改行で文章を分割
 * 2. 各行の前後の空白を削除
 * 3. 空の行を除去
 * 4. 各行を`<p>タグで囲む
 * 5. インデント付きで結合（HTMLの可読性向上のため）
 *
 * 【具体例】
 * 入力:
 *   "AIは急速に発展しています。\n\n多くの分野で活用されています。"
 *
 * 出力:
 *   "<p>AIは急速に発展しています。</p>\n      <p>多くの分野で活用されています。</p>"
 *
 * @param {string} text - 変換するプレーンテキスト
 * @returns {string} HTMLの段落文字列
 */
const toHtmlParagraphs = (text) => {
  if (!text) return '';
  return text
    .split(/\n+/)               // 1つ以上の改行で分割
    .map((line) => line.trim()) // 各行の前後の空白を削除
    .filter(Boolean)            // 空の行を除去
    .map((line) => `<p>${line}</p>`) // <p>タグで囲む
    .join('\n      '); // 整形のためにインデント付きで結合（HTML出力が見やすくなる）
};

/**
 * 日付文字列（'YYYY-MM-DD'）を複数のフォーマットに変換します。
 *
 * この関数は、ISO形式の日付文字列を受け取り、3つの異なる形式で返します:
 * 1. dotted: ドット区切り形式（例: 2025.11.19） - 簡潔な表示用
 * 2. verbose: 日本語形式（例: 2025年11月19日） - 詳細な表示用
 * 3. year: 年のみ（例: 2025） - フッターのコピーライト表示などに使用
 *
 * 【エラーハンドリング】
 * - 入力がない場合: 空文字列とcurrentYearを返す
 * - 無効な日付文字列の場合: 元の値をそのまま返す
 *
 * 【日付の解釈】
 * - 入力: "2025-11-19" または "2025/11/19"
 * - UTC時刻として解釈（タイムゾーンの影響を受けない）
 *
 * @param {string} value - フォーマットする日付文字列（YYYY-MM-DD形式）
 * @returns {{dotted: string, verbose: string, year: number}} フォーマットされた日付パーツ
 *
 * @example
 * formatDateParts('2025-11-19')
 * // => { dotted: '2025.11.19', verbose: '2025年11月19日', year: 2025 }
 */
const formatDateParts = (value) => {
  const now = new Date();

  // 入力がない場合は空文字列と現在の年を返す
  if (!value) {
    return { dotted: '', verbose: '', year: now.getFullYear() };
  }

  // スラッシュ区切りをハイフンに統一（'2025/11/19' → '2025-11-19'）
  const normalized = value.replace(/\//g, '-');

  // UTCタイムゾーンで日付を解釈（タイムゾーンの影響を避ける）
  const date = new Date(`${normalized}T00:00:00Z`);

  // 日付が無効な場合は元の値をそのまま返す
  if (Number.isNaN(date.getTime())) {
    return { dotted: value, verbose: value, year: now.getFullYear() };
  }

  // 年・月・日を取得
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0'); // 月は0始まりなので+1、2桁にゼロパディング
  const d = String(date.getDate()).padStart(2, '0');      // 日も2桁にゼロパディング

  return {
    dotted: `${y}.${m}.${d}`,      // ドット区切り形式
    verbose: `${y}年${m}月${d}日`,  // 日本語形式
    year: y,                        // 年のみ
  };
};

/**
 * 見出し文字列をHTML要素のID属性として使用できるスラッグに変換します。
 *
 * この関数は、記事の見出し（H2, H3）を元に、目次やページ内リンクで使用する
 * IDを生成します。HTMLのID属性はURL-safeで一意である必要があるため、
 * 日本語や特殊文字を除去してケバブケース形式に変換します。
 *
 * 【処理の流れ】
 * 1. 見出しがない場合はフォールバック値（section-1など）を使用
 * 2. 小文字に変換
 * 3. 日本語の区切り文字（・、。/など）とスペースをハイフンに変換
 * 4. 英数字とハイフン以外を削除
 * 5. 連続するハイフンを1つに統合
 * 6. 先頭と末尾のハイフンを削除
 * 7. 結果が空の場合はフォールバック値を使用
 *
 * 【具体例】
 * - "AIの活用事例" → "ai-shi-yong-shi-li" （ピンインが残る場合）または空
 * - "ChatGPT とは？" → "chatgpt"
 * - "Section 1: はじめに" → "section-1"
 *
 * @param {string} heading - 見出し文字列
 * @param {number} [index=0] - フォールバック用のインデックス
 * @returns {string} スラッグ化された文字列
 *
 * @example
 * slugifyHeading('AIの活用方法', 0)     // => フォールバック: "section-1"
 * slugifyHeading('ChatGPT Guide', 1)    // => "chatgpt-guide"
 * slugifyHeading('', 2)                 // => "section-3"
 */
const slugifyHeading = (heading, index = 0) => {
  // 見出しがない場合のフォールバック値
  const base = heading || `section-${index + 1}`;

  // スラグ化処理
  const slug = base
    .toString()                          // 文字列に変換
    .trim()                              // 前後の空白を削除
    .toLowerCase()                       // 小文字化
    .replace(/[\s\・\、\。/]+/g, '-')   // 日本語の区切り文字とスペースをハイフンに
    .replace(/[^a-z0-9\-]/g, '')        // 英数字とハイフン以外を削除
    .replace(/-+/g, '-')                // 連続するハイフンを1つに統合
    .replace(/^-|-$/g, '');             // 先頭と末尾のハイフンを削除

  // スラグが空になった場合はフォールバック値を返す
  return slug || `section-${index + 1}`;
};

/**
 * テンプレートレンダラーのインスタンスを作成するファクトリ関数です。
 * @param {{templatePath: string}} dependencies - 依存関係（テンプレートファイルのパス）
 * @returns {{compileArticleHtml: Function}} `compileArticleHtml`メソッドを持つオブジェクト
 */
const createTemplateRenderer = ({ templatePath }) => {
  // テンプレートファイルをキャッシュするための変数
  let cachedArticleTemplate = null;
  let articleTemplateLoaded = false;

  /**
   * 記事のHTMLテンプレートを読み込み、キャッシュします。
   * @returns {string|null} テンプレート文字列、または読み込み失敗時はnull
   */
  const getArticleTemplate = () => {
    if (articleTemplateLoaded) return cachedArticleTemplate;
    try {
      cachedArticleTemplate = fs.readFileSync(templatePath, 'utf-8');
    } catch (error) {
      cachedArticleTemplate = null;
      console.warn('[generator] 記事テンプレートの読み込みに失敗しました:', error.message);
    } finally {
      articleTemplateLoaded = true;
    }
    return cachedArticleTemplate;
  };

  /**
   * テンプレート文字列内のプレースホルダー（`{{TOKEN}}`）を実際の値で置換します。
   * @param {object} slots - `プレースホルダー名: 置換後の値` のマッピング
   * @returns {string|null} レンダリングされたHTML文字列、またはテンプレートがない場合はnull
   */
  const renderArticleTemplate = (slots) => {
    const template = getArticleTemplate();
    if (!template) return null;
    // 全てのプレースホルダーを対応する値で置換
    return Object.entries(slots).reduce((html, [token, value]) => {
      const safeValue = value ?? '';
      const pattern = new RegExp(escapeRegExp(token), 'g');
      return html.replace(pattern, safeValue);
    }, template);
  };

  /**
   * 記事データ、メタデータ、オプションを元に、最終的な記事HTMLを組み立てます。
   * @param {object} article - AIが生成した記事データ
   * @param {object} meta - 日付やソース情報などのメタデータ
   * @param {object} [options={}] - アセットパスなどの追加オプション
   * @returns {string} 完成したHTML文字列
   */
  const compileArticleHtml = (article, meta, options = {}) => {
    // --- 1. 基本設定とデータ準備 ---
    const assetBase = typeof options.assetBase === 'string' ? options.assetBase : '../';
    const normalizedAssetBase = assetBase.endsWith('/') ? assetBase : `${assetBase}/`;
    
    const sections = Array.isArray(article.sections) ? article.sections : [];
    const tags = Array.isArray(article.tags) ? article.tags : [];

    const dateParts = formatDateParts(meta.date);
    const displayDate = dateParts.dotted || meta.date || '';
    const verboseDate = dateParts.verbose || meta.date || '';
    const heroImage = (meta && meta.image) || options.image || null;
    const heroImageSrc = heroImage?.src ? `${normalizedAssetBase}${heroImage.src}` : null;
    const socialImage = heroImageSrc || `${normalizedAssetBase}assets/img/ogp-default.svg`;

    // --- 2. 各パーツのHTMLマークアップ生成 ---

    // タグリストのHTMLを生成
    const renderTagList = (items) => {
      if (!Array.isArray(items) || items.length === 0) return '';
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
      return `<ul class="article-tags">\n          ${tagItems}\n        </ul>`;
    };
    const tagMarkup = renderTagList(tags);

    // 記事メタ情報グリッド（公開日、ソースなど）のHTMLを生成
    const renderMetaGrid = () => {
      const cards = [];
      if (verboseDate || displayDate) {
        cards.push(`
          <article class="meta-card">
            <p class="meta-label">公開日</p>
            <p class="meta-value">${verboseDate || displayDate}</p>
            ${displayDate ? `<small>最終更新: ${displayDate}</small>` : ''}
          </article>`);
      }
      if (meta?.sourceName || meta?.sourceUrl) {
        const label = meta.sourceName || 'リサーチソース';
        const link = meta.sourceUrl ? `<a href="${meta.sourceUrl}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
        cards.push(`
          <article class="meta-card">
            <p class="meta-label">リサーチソース</p>
            <p class="meta-value">${link}</p>
            ${meta.sourceUrl ? '<small>外部リンク</small>' : ''}
          </article>`);
      }
      if (meta?.videoUrl) {
        const videoLabel = meta.videoTitle || '参照動画を再生';
        cards.push(`
          <article class="meta-card">
            <p class="meta-label">参照動画</p>
            <p class="meta-value"><a href="${meta.videoUrl}" target="_blank" rel="noopener noreferrer">${videoLabel}</a></p>
            <small>YouTube</small>
          </article>`);
      }
      if (!cards.length) return '';
      return `\n        <div class="article-meta-grid">\n${cards.join('\n')}\n        </div>`;
    };
    const metaGridMarkup = renderMetaGrid();

    // 共有リンクのHTML
    const shareLinksMarkup = `
        <div class="article-share-links">
          <a class="share-link" href="#" data-share-target="x" aria-label="Xで共有">Xに共有</a>
          <a class="share-link" href="#" data-share-target="linkedin" aria-label="LinkedInで共有">LinkedIn</a>
          <button class="share-link" type="button" data-share-target="native">端末で共有</button>
          <button class="share-link copy-link" type="button" data-copy-link>リンクをコピー</button>
        </div>`;

    // 広告スロットのHTML（現在はコメントアウト）
    const adTopMarkup = `
      <!-- Google AdSense: 記事上広告 -->
      <!--
      <div class="inner">
        <div class="ad-container ad-article-top">
          <span class="ad-label">広告</span>
        </div>
      </div>
      -->
`;
    const adMiddleMarkup = `
            <!-- Google AdSense: 記事中広告 -->
            <!--
            <div class="ad-container ad-article-middle">
              <span class="ad-label">広告</span>
            </div>
            -->
`;
    const adBottomMarkup = `
      <!-- Google AdSense: 記事下広告 -->
      <!--
      <div class="inner">
        <div class="ad-container ad-article-bottom">
          <span class="ad-label">広告</span>
        </div>
      </div>
      -->
`;

    // サブセクション（H3）のHTMLを生成
    const renderSubSections = (subSections = [], parentIndex = 0) => {
      if (!Array.isArray(subSections) || subSections.length === 0) return '';
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

    // メインセクション（H2）のHTMLを生成
    const sectionMarkup = sections
      .map((section, index) => {
        const heading = section.heading ?? `セクション${index + 1}`;
        const slug = slugifyHeading(heading, index);
        const overview = toHtmlParagraphs(section.overview || section.body || '');
        const subSections = renderSubSections(section.subSections, index);
        const overviewMarkup = overview ? `<div class="section-overview">${overview}</div>` : '';
        const adInsert = index === 0 ? adMiddleMarkup : '';
        return `
            <section class="article-section" id="${slug}">
              <h2 class="section-heading">${heading}</h2>
              ${overviewMarkup}
              ${subSections}
            </section>${adInsert}`;
      })
      .join('\n');

    // 導入部分のHTMLを生成
    const introMarkup = article.intro ? `
        <section class="article-intro-block">
          <div class="intro-content">
${toHtmlParagraphs(article.intro)}
          </div>
        </section>` : '';

    // まとめ部分のHTMLを生成
    const conclusionMarkup = article.conclusion ? `
      <section class="article-conclusion inner">
        <h2 class="conclusion-heading">まとめ</h2>
        <div class="conclusion-content">
${toHtmlParagraphs(article.conclusion)}
        </div>
      </section>` : '';

    const summaryText = article.summary ?? '';
    const publishedTimeIso = meta.date ? `${meta.date}T00:00:00+09:00` : new Date().toISOString();

    // --- 3. テンプレートへの埋め込み ---
    // テンプレート内のプレースホルダーと、生成したHTMLマークアップを対応付ける
    const templateSlots = {
      '{{ASSET_BASE}}': normalizedAssetBase,
      '{{TITLE}}': article.title,
      '{{SUMMARY}}': summaryText,
      '{{SOCIAL_IMAGE}}': socialImage,
      '{{PUBLISHED_AT_ISO}}': publishedTimeIso,
      '{{DISPLAY_DATE}}': displayDate,
      '{{TAG_MARKUP}}': tagMarkup,
      '{{META_GRID}}': metaGridMarkup,
      '{{SHARE_LINKS}}': shareLinksMarkup,
      '{{AD_TOP}}': adTopMarkup,
      '{{INTRO_MARKUP}}': introMarkup,
      '{{SECTION_MARKUP}}': sectionMarkup,
      '{{AD_BOTTOM}}': adBottomMarkup,
      '{{CONCLUSION_MARKUP}}': conclusionMarkup,
    };

    // テンプレートに値を埋め込む
    const templatedHtml = renderArticleTemplate(templateSlots);
    if (templatedHtml) {
      return templatedHtml;
    }

    // --- 4. フォールバック ---
    // テンプレートの読み込みに失敗した場合、ここで最小限のHTML構造を生成して返す
    console.warn('[generator] テンプレートファイルが利用できないため、フォールバックHTMLを生成します。');
    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${article.title} | AI情報ブログ</title>
  <meta name="description" content="${summaryText}">
  <meta property="og:title" content="${article.title} | AI情報ブログ">
  <meta property="og:description" content="${summaryText}">
  <meta property="og:image" content="${socialImage}">
  <meta property="article:published_time" content="${publishedTimeIso}">
  <meta name="twitter:card" content="summary_large_image">
</head>
<body>
  <main>
    <article>
      <h1>${article.title}</h1>
      <p>${summaryText}</p>
      ${introMarkup}
      ${sectionMarkup}
      ${conclusionMarkup}
    </article>
  </main>
</body>
</html>`;
  };

  return { compileArticleHtml };
};

module.exports = {
  createTemplateRenderer,
};