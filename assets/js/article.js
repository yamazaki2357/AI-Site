/**
 * @fileoverview 記事詳細ページ専用のUI制御スクリプト
 * 以下の機能を提供します:
 * - 目次（Table of Contents）の自動生成とスクロール連動ハイライト
 * - 読書進捗バーの表示
 * - 目次のレスポンシブ対応（折りたたみ機能）
 * - 記事内タグのクリックによるトップページへの遷移
 */

/**
 * 記事詳細ページの初期化関数
 * Barba.jsによるページ遷移後にも呼び出せるようにグローバル関数として定義
 */
window.initArticlePage = () => {
  'use strict';

  // <body>に 'article-page' クラスがなければ記事ページではないと判断し、処理を中断
  // Barba.js遷移後はbodyのクラスが更新されていない可能性があるため、
  // data-barba-namespaceもチェックするとより堅牢だが、
  // ここでは既存のクラスチェックに加え、コンテナ内の要素チェックも行う。
  const root = document.body;
  const articleContainer = document.querySelector('.article-detail');

  if ((!root || !root.classList.contains('article-page')) && !articleContainer) return;

  const currentUrl = window.location.href;
  const title = document.title.replace(/ \| AI情報ブログ$/, '') || 'AI情報ブログ';

  // --- 2. 目次 (Table of Contents) の自動生成 ---
  const setupTableOfContents = () => {
    const tocList = document.querySelector('[data-toc-list]');
    const headings = document.querySelectorAll('.post-article h2, .post-article h3, .article-content h2, .article-content h3');

    if (!tocList || headings.length === 0) {
      if (tocList) {
        tocList.innerHTML = '<li>目次はありません</li>';
      }
      return;
    }

    tocList.innerHTML = ''; // 既存の目次をクリア

    // 見出しテキストをID用のスラッグに変換する関数
    const slugify = (text) => text.trim().toLowerCase().replace(/[\s・、。/]+/g, '-').replace(/[^a-z0-9\-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');

    let h2Counter = 0;
    let h3Counter = 0;

    // 各見出しをループ処理
    headings.forEach((heading, index) => {
      const text = heading.textContent || `section-${index + 1}`;
      const slug = heading.id || slugify(text) || `section-${index + 1}`;
      heading.id = slug; // 見出し自体にIDを付与
      heading.classList.add('toc-target'); // スクロールターゲット用のクラス

      // H2とH3の階層構造をカウント
      if (heading.tagName === 'H2') {
        h2Counter += 1;
        h3Counter = 0;
      } else {
        if (h2Counter === 0) h2Counter = 1; // H2なしでH3が始まった場合
        h3Counter += 1;
      }
      const indexLabel = heading.tagName === 'H3' ? `${h2Counter}.${h3Counter}` : `${h2Counter}`;

      // 目次リストのアイテム(li)を作成
      const item = document.createElement('li');
      item.dataset.sectionId = slug;
      item.dataset.tocIndex = indexLabel;
      if (heading.tagName === 'H3') {
        item.classList.add('is-depth'); // H3ならインデント用のクラスを付与
      }

      // アンカーリンク(a)を作成
      const anchor = document.createElement('a');
      anchor.href = `#${slug}`;
      anchor.setAttribute('data-toc-link', 'true');
      anchor.innerHTML = `<span class="toc-index">${indexLabel}</span><span class="toc-text">${text.trim()}</span>`;

      item.appendChild(anchor);
      tocList.appendChild(item);
    });

    // 目次リンククリック時のスムーズスクロール処理
    const tocClickHandler = (e) => {
      const link = e.target.closest('a[data-toc-link="true"]');
      if (!link) return;

      e.preventDefault();
      const targetId = link.getAttribute('href').slice(1);
      const target = document.getElementById(targetId);
      if (target) {
        const headerOffset = 100; // ヘッダーの高さを考慮したオフセット
        const elementPosition = target.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
        window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
      }
    };
    tocList.addEventListener('click', tocClickHandler);
  };
  setupTableOfContents();


  // --- 3. 読書進捗インジケーター ---
  // ページ上部に読書進捗を示すプログレスバーを表示する
  const initReadingProgress = () => {
    // 既存のバーがあれば削除（ページ遷移時の重複を防ぐ）
    const existingBar = document.querySelector('.reading-progress');
    if (existingBar) existingBar.remove();

    const progressBar = document.createElement('div');
    progressBar.className = 'reading-progress';
    progressBar.innerHTML = '<div class="reading-progress-bar"></div>';
    document.body.prepend(progressBar);

    const bar = progressBar.querySelector('.reading-progress-bar');
    const articleContent = document.querySelector('.article-content, .post-article');
    if (!articleContent) return;

    // スクロール位置に応じてプログレスバーの幅を更新する
    const updateProgress = () => {
      const articleTop = articleContent.offsetTop;
      const articleHeight = articleContent.offsetHeight;
      const scrollPosition = window.pageYOffset;
      const windowHeight = window.innerHeight;

      // 記事の開始位置と終了位置を計算
      const scrollStart = articleTop;
      const scrollEnd = articleTop + articleHeight - windowHeight;

      // 現在の読書進捗を0〜100の範囲で計算
      let progress = 0;
      if (scrollPosition >= scrollStart && scrollPosition <= scrollEnd) {
        progress = ((scrollPosition - scrollStart) / (scrollEnd - scrollStart)) * 100;
      } else if (scrollPosition > scrollEnd) {
        progress = 100;
      }

      // プログレスバーの幅を更新
      bar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
    };

    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress, { passive: true });
    updateProgress();

  };
  initReadingProgress();


  // --- 4. 目次のレスポンシブ対応と現在地表示 ---
  const initResponsiveToc = () => {
    const tocCard = document.querySelector('.article-card.article-toc');
    const tocList = tocCard?.querySelector('[data-toc-list]');
    const headings = document.querySelectorAll('.toc-target');
    if (!tocCard || !tocList || headings.length === 0) return;

    // --- DOM構造のセットアップ ---
    // 既にセットアップ済みかチェック
    if (tocCard.querySelector('.article-card-header')) return;

    const header = document.createElement('div');
    header.className = 'article-card-header';
    const label = tocCard.querySelector('.article-card-label');
    header.appendChild(label);

    const panel = document.createElement('div');
    panel.className = 'toc-panel';
    panel.id = 'article-toc-panel';
    panel.appendChild(tocList);

    const indicator = document.createElement('p');
    indicator.className = 'toc-current-section';
    indicator.setAttribute('data-current-section', 'true');
    indicator.textContent = '現在位置: -';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'toc-toggle';
    toggle.setAttribute('aria-controls', panel.id);
    header.appendChild(toggle);

    tocCard.prepend(header);
    tocCard.appendChild(panel);
    tocCard.insertBefore(indicator, panel);

    // --- 状態管理とイベントリスナー ---
    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const state = {
      isMobile: mediaQuery.matches,
      expanded: !mediaQuery.matches,
    };

    const applyState = () => {
      state.isMobile = mediaQuery.matches;
      if (!state.isMobile) state.expanded = true; // PCでは常に展開

      const shouldShow = !state.isMobile || state.expanded;
      panel.hidden = !shouldShow;
      toggle.setAttribute('aria-expanded', String(shouldShow));
      toggle.textContent = state.expanded ? '目次を隠す' : '目次を表示';
      tocCard.dataset.mobileCollapsed = String(state.isMobile && !state.expanded);
    };

    const toggleHandler = () => {
      if (!state.isMobile) return;
      state.expanded = !state.expanded;
      applyState();
    };
    toggle.addEventListener('click', toggleHandler);

    const mediaQueryHandler = () => applyState();
    mediaQuery.addEventListener('change', mediaQueryHandler);
    applyState(); // 初期状態を適用



    // --- スクロール連動ハイライト ---
    // スクロール位置に応じて、現在表示中のセクションを目次上でハイライトする
    const tocItems = Array.from(tocList.querySelectorAll('li[data-section-id]'));
    const sections = Array.from(headings);

    // 現在のスクロール位置に基づいて、アクティブな目次項目を更新
    const updateActiveToc = () => {
      const scrollPosition = window.pageYOffset + 120; // ヘッダーオフセット分を加味
      let activeSection = null;
      // 上から順に見ていき、スクロール位置を超えている最後のセクションを見つける
      for (const section of sections) {
        if (section.offsetTop <= scrollPosition) {
          activeSection = section;
        } else {
          break;
        }
      }

      // 全ての目次項目からactiveクラスを削除
      tocItems.forEach(item => item.classList.remove('active'));

      // アクティブなセクションがある場合、対応する目次項目をハイライト
      if (activeSection) {
        const activeItem = tocItems.find(item => item.dataset.sectionId === activeSection.id);
        if (activeItem) {
          activeItem.classList.add('active');
          const index = activeItem.dataset.tocIndex || '';
          const text = activeItem.querySelector('.toc-text')?.textContent || '';
          // 現在位置を表示
          indicator.textContent = `現在位置: ${index} ${text.trim()}`;
          return;
        }
      }
      indicator.textContent = '現在位置: -';
    };

    window.addEventListener('scroll', updateActiveToc, { passive: true });
    updateActiveToc(); // 初期表示


  };
  initResponsiveToc();


  // --- 5. 記事内タグのクリック機能 ---
  // 記事ページ内のタグをクリックすると、トップページのそのタグでフィルタリングされたページに遷移する
  const setupTagLinks = () => {
    const clickHandler = (e) => {
      const tagElement = e.target.closest('.tag[data-tag-slug]');
      // 記事ページ内でのみ動作
      if (!tagElement || (!document.body.classList.contains('article-page') && !document.querySelector('.article-detail'))) return;

      e.preventDefault();
      e.stopPropagation();

      const slug = tagElement.getAttribute('data-tag-slug');
      if (!slug) return;

      // ルートパスからの相対パスを計算してリダイレクト
      // posts/ディレクトリ内からは '../' を、それ以外からは './' を使用
      const basePath = window.location.pathname.includes('/posts/') ? '../' : './';
      window.location.href = `${basePath}index.html?tag=${encodeURIComponent(slug)}`;
    };

    document.addEventListener('click', clickHandler);


    // タグにクリック可能なカーソルスタイルを適用
    const applyTagStyles = () => {
      document.querySelectorAll('.article-tags .tag[data-tag-slug], .article-hero .tag[data-tag-slug]').forEach(tag => {
        tag.style.cursor = 'pointer';
      });
    };
    applyTagStyles();
  };
  setupTagLinks();


};

// 初回読み込み時
document.addEventListener('DOMContentLoaded', () => {
  window.initArticlePage();
});