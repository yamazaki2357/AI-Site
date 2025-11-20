/**
 * @fileoverview AI情報ブログ メインスクリプト (トップページ用)
 * サイト全体の共通機能と、記事一覧ページのインタラクティブなUIを制御します。
 */

// --- 共通UI機能 ---

/**
 * スクロール時にヘッダーのスタイルを変更します。
 * 一定以上スクロールされると、ヘッダーに 'scrolled' クラスを追加して背景などを変更します。
 */
(function initHeaderScroll() {
  const header = document.querySelector('.site-header');
  if (!header) return;
  const scrollThreshold = 50; // 50pxスクロールされたら発火

  window.addEventListener('scroll', () => {
    if (window.pageYOffset > scrollThreshold) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }, { passive: true }); // パフォーマンス向上のためpassive: trueを指定
})();


/**
 * ページ内アンカーリンク（`#`で始まるリンク）のスムーズスクロールを実装します。
 */
(function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#') return; // href="#"だけのリンクは無視

      try {
        const target = document.querySelector(href);
        if (target) {
          e.preventDefault();
          const headerOffset = 80; // ヘッダーの高さを考慮したオフセット
          const elementPosition = target.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

          window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
          });
        }
      } catch (error) {
        // 無効なセレクタなどによるエラーを無視
        console.warn(`Smooth scroll target not found or invalid: ${href}`);
      }
    });
  });
})();


/**
 * IntersectionObserverを使用して、要素が画面内に入ったときにフェードインアニメーションを適用します。
 */
(function initScrollAnimations() {
  // IntersectionObserverがサポートされていないブラウザでは何もしない
  if (!('IntersectionObserver' in window)) return;

  const observerOptions = {
    threshold: 0.1, // 要素が10%表示されたら発火
    rootMargin: '0px 0px -50px 0px' // 画面下部から50px手前で判定を開始
  };

  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target); // 一度表示されたら監視を解除
      }
    });
  }, observerOptions);

  // .animate-on-scrollクラスを持つ要素を監視対象とする
  document.querySelectorAll('.animate-on-scroll, .post-card, .workflow-card, .source-card, .info-panel, .hero-panel').forEach(el => {
    observer.observe(el);
  });
})();


// --- 記事一覧ページの機能 ---

/**
 * 記事一覧の読み込み、フィルタリング、タグ検索機能を初期化します。
 * この機能はトップページ（`#post-list`要素が存在するページ）でのみ動作します。
 */
(function initPostList() {
  const listContainer = document.getElementById('post-list');
  if (!listContainer) return; // 記事一覧コンテナがなければ処理を中断

  // --- DOM要素の取得 ---
  const elements = {
    list: listContainer,
    errorLabel: document.getElementById('post-error'),
    tagSearchPanel: document.getElementById('tag-search-panel'),
    tagSearchInput: document.getElementById('tag-search-input'),
    tagSearchClear: document.getElementById('tag-search-clear'),
    selectedTagWrapper: document.getElementById('tag-search-selected'),
    selectedTagLabel: document.getElementById('tag-search-selected-label'),
    selectedTagClear: document.getElementById('tag-search-selected-clear'),
    tagSuggestions: document.getElementById('tag-search-suggestions'),
    filterStatus: document.getElementById('tag-filter-status'),
    tagSearchToggle: document.getElementById('tag-search-toggle'),
  };

  // --- 状態管理 ---
  const state = {
    allPosts: [],       // 全記事データ
    filteredPosts: [],  // フィルタリング後の記事データ
    allTags: [],        // 全タグデータ（頻度順）
    searchQuery: '',    // タグ検索クエリ
    selectedTag: null,  // 選択中のタグ
    isLoading: true,    // 読み込み中フラグ
  };

  // --- 関数の定義 ---

  /**
   * フィルタリング用の値を正規化します（小文字、トリム、NFKC正規化）。
   * @param {*} value - 正規化する値
   * @returns {string} 正規化された文字列
   */
  const normalize = (value) => String(value ?? '').normalize('NFKC').trim().toLowerCase();

  /**
   * 記事データからタグの一覧と出現回数を集計し、インデックスを構築します。
   * @param {Array<object>} posts - 記事データの配列
   * @returns {Array<object>} タグオブジェクトの配列（頻度順）
   */
  const buildTagIndex = (posts) => {
    const tagMap = new Map();
    posts.forEach(post => {
      (post.tags || []).forEach(tag => {
        const tagObj = toTagObject(tag);
        if (!tagMap.has(tagObj.slug)) {
          tagMap.set(tagObj.slug, { ...tagObj, count: 0 });
        }
        tagMap.get(tagObj.slug).count++;
      });
    });
    return Array.from(tagMap.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ja'));
  };

  /**
   * 記事をタグのスラッグでフィルタリングします。
   * @param {string | null} slug - フィルタするタグのスラッグ。nullの場合は全記事を返す。
   * @returns {Array<object>} フィルタリングされた記事の配列
   */
  const filterPostsByTag = (slug) => {
    if (!slug) return [...state.allPosts];
    return state.allPosts.filter(post =>
      (post.tags || []).some(tag => toTagObject(tag).slug === slug)
    );
  };

  /**
   * 記事カードのHTML文字列を生成します。
   * @param {object} post - 記事データ
   * @param {number} index - 配列内でのインデックス（アニメーション遅延用）
   * @returns {string} 記事カードのHTML
   */
  const createPostCardHTML = (post, index) => {
    const defaultImg = 'assets/img/article-templates/new_default.svg';
    const imageSrc = post.image?.src || defaultImg;
    const imageAlt = post.image?.alt || post.title;
    const tagsHTML = (post.tags || []).map(tag => {
      const tagObj = toTagObject(tag);
      return `<li class="tag" data-tag-slug="${tagObj.slug}" style="cursor: pointer;">${tagObj.label}</li>`;
    }).join('');

    return `
      <li class="post-card animate-on-scroll" style="animation-delay: ${index * 0.05}s;">
        <a href="${post.url}" class="post-card-link" aria-label="${post.title}">
          <figure class="post-card-cover">
            <img src="${imageSrc}" alt="${imageAlt}" loading="lazy" decoding="async" width="640" height="360">
          </figure>
          <div class="post-card-body">
            <div class="post-meta">${formatDate(post.date)}</div>
            <h3>${post.title}</h3>
            <p class="post-summary">${post.summary ?? ''}</p>
            ${tagsHTML ? `<ul class="tag-list">${tagsHTML}</ul>` : ''}
          </div>
        </a>
      </li>
    `;
  };

  /**
   * 記事一覧をDOMにレンダリング（描画）します。
   * @param {Array<object>} posts - 描画する記事の配列
   */
  const renderPosts = (posts) => {
    if (posts.length > 0) {
      elements.list.innerHTML = posts.map(createPostCardHTML).join('');
    } else {
      elements.list.innerHTML = `<li class="no-results">該当する記事が見つかりませんでした。</li>`;
    }
    // 新しく生成された要素にアニメーションを再適用
    document.querySelectorAll('.animate-on-scroll').forEach(el => {
      el.classList.remove('is-visible'); // 一旦非表示に
      const observer = new IntersectionObserver(entries => {
        if (entries[0].isIntersecting) {
          entries[0].target.classList.add('is-visible');
          observer.unobserve(entries[0].target);
        }
      }, { threshold: 0.1 });
      observer.observe(el);
    });
  };

  /**
   * タグ検索のサジェストリストをレンダリングします。
   */
  const renderTagSuggestions = () => {
    const query = normalize(state.searchQuery);
    const suggestions = query
      ? state.allTags.filter(tag => normalize(tag.label).includes(query) || normalize(tag.slug).includes(query))
      : state.allTags;

    if (suggestions.length > 0) {
      elements.tagSuggestions.innerHTML = suggestions.slice(0, 18).map(tag => {
        const isActive = state.selectedTag?.slug === tag.slug;
        return `
          <button type="button" class="tag-search-chip${isActive ? ' active' : ''}" data-tag-slug="${tag.slug}">
            <span>${tag.label}</span>
            <span class="tag-count">${tag.count}件</span>
          </button>
        `;
      }).join('');
    } else {
      elements.tagSuggestions.innerHTML = `<p class="tag-search-empty">該当するタグが見つかりません。</p>`;
    }
  };

  /**
   * UIの状態をまとめて更新します。
   */
  const updateUI = () => {
    renderPosts(state.filteredPosts);
    renderTagSuggestions();

    // 選択中タグのUI
    if (state.selectedTag) {
      elements.selectedTagWrapper.hidden = false;
      elements.selectedTagLabel.textContent = `${state.selectedTag.label} (${state.filteredPosts.length}件)`;
    } else {
      elements.selectedTagWrapper.hidden = true;
    }

    // フィルタ状況のテキスト
    if (state.selectedTag) {
      elements.filterStatus.textContent = `タグ「${state.selectedTag.label}」でフィルタ中 (${state.filteredPosts.length}件)`;
    } else {
      elements.filterStatus.textContent = `全${state.allPosts.length}件の記事を表示中`;
    }

    // 検索クリアボタンの状態
    elements.tagSearchClear.disabled = !state.searchQuery;
  };

  /**
   * タグによるフィルタリングを適用します。
   * @param {object | null} tag - 選択されたタグオブジェクト。nullでフィルタ解除。
   */
  const applyTagFilter = (tag) => {
    state.selectedTag = tag;
    state.filteredPosts = filterPostsByTag(tag?.slug);

    // URLのクエリパラメータを更新
    const url = new URL(window.location);
    if (tag) {
      url.searchParams.set('tag', tag.slug);
    } else {
      url.searchParams.delete('tag');
    }
    window.history.pushState({}, '', url);

    updateUI();
  };

  // --- イベントリスナーの設定 ---

  // タグ検索入力
  elements.tagSearchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderTagSuggestions();
    elements.tagSearchClear.disabled = !state.searchQuery;
  });

  // 検索クリアボタン
  elements.tagSearchClear.addEventListener('click', () => {
    state.searchQuery = '';
    elements.tagSearchInput.value = '';
    elements.tagSearchInput.focus();
    renderTagSuggestions();
    elements.tagSearchClear.disabled = true;
  });

  // 選択中タグのクリアボタン
  elements.selectedTagClear.addEventListener('click', () => applyTagFilter(null));

  // サジェストされたタグのクリック
  elements.tagSuggestions.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-tag-slug]');
    if (!button) return;
    const slug = button.dataset.tagSlug;
    const tag = state.allTags.find(t => t.slug === slug);
    if (tag) {
      // 同じタグが選択されていたら解除、違えば選択
      applyTagFilter(state.selectedTag?.slug === slug ? null : tag);
    }
  });

  // 記事カード内のタグクリック（イベント委譲）
  elements.list.addEventListener('click', (e) => {
    const tagEl = e.target.closest('.tag[data-tag-slug]');
    if (!tagEl) return;
    e.preventDefault();
    e.stopPropagation();
    const slug = tagEl.dataset.tagSlug;
    const tag = state.allTags.find(t => t.slug === slug);
    if (tag) {
      applyTagFilter(tag);
      // タグ検索パネルまでスクロール
      elements.tagSearchPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  // レスポンシブ対応のトグルボタン
  elements.tagSearchToggle.addEventListener('click', () => {
    const isExpanded = elements.tagSearchToggle.getAttribute('aria-expanded') === 'true';
    elements.tagSearchToggle.setAttribute('aria-expanded', !isExpanded);
    elements.tagSearchPanel.dataset.mobileOpen = String(!isExpanded);
  });

  // --- 初期化処理 ---

  // スケルトンローダーを表示
  elements.list.innerHTML = Array(6).fill('<li class="post-card skeleton"><div class="skeleton-media"></div><div class="post-card-body"><div class="skeleton-line"></div><div class="skeleton-line short"></div></div></li>').join('');

  // posts.jsonをフェッチ
  fetch('data/posts.json', { cache: 'no-cache' })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(posts => {
      state.allPosts = posts.sort(comparePosts); // 日付でソート
      state.allTags = buildTagIndex(state.allPosts);
      state.isLoading = false;
      elements.tagSearchInput.disabled = false;

      // URLパラメータから初期タグを読み込む
      const initialTagSlug = new URLSearchParams(window.location.search).get('tag');
      const initialTag = initialTagSlug ? state.allTags.find(t => t.slug === initialTagSlug) : null;

      applyTagFilter(initialTag); // 初期フィルタを適用してUIを更新
    })
    .catch(error => {
      console.error('記事一覧の読み込みに失敗しました', error);
      elements.list.innerHTML = '';
      elements.errorLabel.textContent = '記事一覧の読み込みに失敗しました。';
      state.isLoading = false;
      updateUI();
    });

  // --- ヘルパー関数 ---
  const formatDate = (iso) => iso ? new Date(iso).toLocaleDateString('ja-JP') : '';
  const comparePosts = (a, b) => new Date(b.date) - new Date(a.date);
  const toTagObject = (tag) => (typeof tag === 'object' ? tag : { slug: normalize(tag), label: tag });

})();