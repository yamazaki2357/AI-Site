/**
 * @fileoverview 記事詳細ページ専用のUI制御スクリプト
 * 以下の機能を提供します:
 * - SNS共有リンクの生成
 * - 目次（Table of Contents）の自動生成とスクロール連動ハイライト
 * - 読書進捗バーの表示
 * - 目次のレスポンシブ対応（折りたたみ機能）
 * - 記事内タグのクリックによるトップページへの遷移
 */
(function initArticlePage() {
  'use strict';

  // <body>に 'article-page' クラスがなければ記事ページではないと判断し、処理を中断
  const root = document.body;
  if (!root || !root.classList.contains('article-page')) return;

  const currentUrl = window.location.href;
  const title = document.title.replace(/ \| AI情報ブログ$/, '') || 'AI情報ブログ';

  // --- 1. SNS共有リンクの生成 ---
  // 共有リンク機能は削除されました（テンプレートから共有ボタンが削除されたため）
  /*
  (function setupShareLinks() {
    const encode = (value) => encodeURIComponent(value);

    // X (Twitter) 共有リンク
    document.querySelectorAll('[data-share-target="x"]').forEach((link) => {
      const url = new URL('https://twitter.com/intent/tweet');
      url.searchParams.set('text', `${title} | AI情報ブログ`);
      url.searchParams.set('url', currentUrl);
      link.setAttribute('href', url.toString());
    });

    // LinkedIn 共有リンク
    document.querySelectorAll('[data-share-target="linkedin"]').forEach((link) => {
      const href = `https://www.linkedin.com/sharing/share-offsite/?url=${encode(currentUrl)}`;
      link.setAttribute('href', href);
    });

    // リンクコピー機能
    const copyButton = document.querySelector('[data-copy-link]');
    if (copyButton) {
      copyButton.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(currentUrl);
          const original = copyButton.textContent;
          copyButton.textContent = 'コピーしました';
          setTimeout(() => {
            copyButton.textContent = original;
          }, 2000);
        } catch (error) {
          console.error('リンクのコピーに失敗しました', error);
          alert('リンクのコピーに失敗しました。');
        }
      });
    }

    // ネイティブ共有機能 (Web Share API)
    const nativeShare = document.querySelector('[data-share-target="native"]');
    if (nativeShare) {
      // Web Share APIが利用可能かチェック
      if (navigator.share) {
        nativeShare.style.display = ''; // ボタンを表示
        nativeShare.addEventListener('click', async () => {
          try {
            await navigator.share({ title, url: currentUrl });
          } catch (error) {
            // ユーザーが共有をキャンセルした場合などはエラーになるが、コンソールに出力する程度に留める
            console.warn('共有がキャンセルまたは失敗しました', error);
          }
        });
      } else {
        nativeShare.style.display = 'none'; // 利用不可ならボタンを隠す
      }
    }
  })();
  */


  // --- 2. 目次 (Table of Contents) の自動生成 ---
  // 記事内のh2, h3見出しを走査し、目次リストを動的に生成します。
  (function setupTableOfContents() {
    const tocList = document.querySelector('[data-toc-list]');
    const headings = document.querySelectorAll('.post-article h2, .post-article h3, .article-content h2, .article-content h3');
    
    if (!tocList || headings.length === 0) {
      if(tocList) {
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
    tocList.addEventListener('click', (e) => {
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
    });
  })();


  // --- 3. 読書進捗インジケーター ---
  // ページ上部に、記事の読了までのおおよその進捗を示すバーを表示します。
  (function initReadingProgress() {
    const progressBar = document.createElement('div');
    progressBar.className = 'reading-progress';
    progressBar.innerHTML = '<div class="reading-progress-bar"></div>';
    document.body.prepend(progressBar);

    const bar = progressBar.querySelector('.reading-progress-bar');
    const articleContent = document.querySelector('.article-content, .post-article');
    if (!articleContent) return;

    const updateProgress = () => {
      const articleTop = articleContent.offsetTop;
      const articleHeight = articleContent.offsetHeight;
      const scrollPosition = window.pageYOffset;
      const windowHeight = window.innerHeight;

      const scrollStart = articleTop;
      const scrollEnd = articleTop + articleHeight - windowHeight;

      let progress = 0;
      if (scrollPosition >= scrollStart && scrollPosition <= scrollEnd) {
        progress = ((scrollPosition - scrollStart) / (scrollEnd - scrollStart)) * 100;
      } else if (scrollPosition > scrollEnd) {
        progress = 100;
      }
      
      bar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
    };

    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress, { passive: true });
    updateProgress();
  })();


  // --- 4. 目次のレスポンシブ対応と現在地表示 ---
  // モバイル表示時に目次を折りたためるようにし、スクロールに連動して現在読んでいるセクションを表示します。
  (function initResponsiveToc() {
    const tocCard = document.querySelector('.article-card.article-toc');
    const tocList = tocCard?.querySelector('[data-toc-list]');
    const headings = document.querySelectorAll('.toc-target');
    if (!tocCard || !tocList || headings.length === 0) return;

    // --- DOM構造のセットアップ ---
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

    toggle.addEventListener('click', () => {
      if (!state.isMobile) return;
      state.expanded = !state.expanded;
      applyState();
    });

    mediaQuery.addEventListener('change', applyState);
    applyState(); // 初期状態を適用

    // --- スクロール連動ハイライト ---
    const tocItems = Array.from(tocList.querySelectorAll('li[data-section-id]'));
    const sections = Array.from(headings);

    const updateActiveToc = () => {
      const scrollPosition = window.pageYOffset + 120; // ヘッダーオフセット分を加味
      let activeSection = null;
      for (const section of sections) {
        if (section.offsetTop <= scrollPosition) {
          activeSection = section;
        } else {
          break;
        }
      }

      tocItems.forEach(item => item.classList.remove('active'));
      
      if (activeSection) {
        const activeItem = tocItems.find(item => item.dataset.sectionId === activeSection.id);
        if (activeItem) {
          activeItem.classList.add('active');
          const index = activeItem.dataset.tocIndex || '';
          const text = activeItem.querySelector('.toc-text')?.textContent || '';
          indicator.textContent = `現在位置: ${index} ${text.trim()}`;
          return;
        }
      }
      indicator.textContent = '現在位置: -';
    };

    window.addEventListener('scroll', updateActiveToc, { passive: true });
    updateActiveToc(); // 初期表示
  })();


  // --- 5. 記事内タグのクリック機能 ---
  // 記事内のタグをクリックすると、そのタグでフィルタリングされたトップページに遷移します。
  (function setupTagLinks() {
    document.addEventListener('click', (e) => {
      const tagElement = e.target.closest('.tag[data-tag-slug]');
      if (!tagElement || !document.body.classList.contains('article-page')) return;

      e.preventDefault();
      e.stopPropagation();

      const slug = tagElement.getAttribute('data-tag-slug');
      if (!slug) return;

      // ルートパスからの相対パスを計算してリダイレクト
      const basePath = window.location.pathname.includes('/posts/') ? '../' : './';
      window.location.href = `${basePath}index.html?tag=${encodeURIComponent(slug)}`;
    });

    // タグにクリック可能なカーソルスタイルを適用
    const applyTagStyles = () => {
      document.querySelectorAll('.article-tags .tag[data-tag-slug], .article-hero .tag[data-tag-slug]').forEach(tag => {
        tag.style.cursor = 'pointer';
      });
    };
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyTagStyles);
    } else {
      applyTagStyles();
    }
  })();

})();