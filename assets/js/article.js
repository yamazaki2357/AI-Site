// ============================================
// 記事詳細ページ専用のUI制御
// ============================================

(function initArticlePage() {
  const root = document.body;
  if (!root || !root.classList.contains('article-page')) return;

  const currentUrl = window.location.href;
  const title = document.title.replace(/ \| AI情報ブログ$/, '') || 'AI情報ブログ';

  // === 共有リンク生成 ===
  const encode = (value) => encodeURIComponent(value);

  document.querySelectorAll('[data-share-target="x"]').forEach((link) => {
    const url = new URL('https://twitter.com/intent/tweet');
    url.searchParams.set('text', `${title} | AI情報ブログ`);
    url.searchParams.set('url', currentUrl);
    link.setAttribute('href', url.toString());
  });

  document.querySelectorAll('[data-share-target="linkedin"]').forEach((link) => {
    const href = `https://www.linkedin.com/sharing/share-offsite/?url=${encode(currentUrl)}`;
    link.setAttribute('href', href);
  });

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
      }
    });
  }

  const nativeShare = document.querySelector('[data-share-target="native"]');
  if (nativeShare) {
    nativeShare.addEventListener('click', async () => {
      if (navigator.share) {
        try {
          await navigator.share({ title, url: currentUrl });
        } catch (error) {
          console.warn('共有がキャンセルされました', error);
        }
      } else if (copyButton) {
        copyButton.click();
      }
    });
  }

  // === 目次の自動生成 ===
  const tocList = document.querySelector('[data-toc-list]');
  const headings = document.querySelectorAll('.post-article h2, .post-article h3, .article-content h2, .article-content h3');
  let tocIndicatorElement = null;

  if (tocList && headings.length > 0) {
    tocList.innerHTML = '';
    const slugify = (text) =>
      text
        .trim()
        .toLowerCase()
        .replace(/[\s・、。/]+/g, '-')
        .replace(/[^a-z0-9\-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

    let h2Counter = 0;
    let h3Counter = 0;

    headings.forEach((heading, index) => {
      const text = heading.textContent || `section-${index + 1}`;
      const slug = heading.id || slugify(text) || `section-${index + 1}`;
      heading.id = slug;
      heading.classList.add('toc-target');

      if (heading.tagName === 'H2') {
        h2Counter += 1;
        h3Counter = 0;
      } else {
        if (h2Counter === 0) {
          h2Counter = 1;
        }
        h3Counter += 1;
      }

      const indexLabel = heading.tagName === 'H3'
        ? `${h2Counter}.${h3Counter}`
        : `${h2Counter}`;

      const item = document.createElement('li');
      item.dataset.sectionId = slug;
      item.dataset.tocIndex = indexLabel;
      if (heading.tagName === 'H3') {
        item.classList.add('is-depth');
      }

      const anchor = document.createElement('a');
      anchor.href = `#${slug}`;
      anchor.setAttribute('data-toc-link', 'true');

      const number = document.createElement('span');
      number.className = 'toc-index';
      number.textContent = indexLabel;

      const label = document.createElement('span');
      label.className = 'toc-text';
      label.textContent = text.trim();

      anchor.appendChild(number);
      anchor.appendChild(label);
      item.appendChild(anchor);
      tocList.appendChild(item);
    });

    // スムーズスクロール
    tocList.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = link.getAttribute('href').slice(1);
        const target = document.getElementById(targetId);
        if (target) {
          const headerOffset = 100;
          const elementPosition = target.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
          window.scrollTo({
            top: offsetPosition,
            behavior: 'smooth'
          });
        }
      });
    });
  } else if (tocList) {
    tocList.innerHTML = '';
    const item = document.createElement('li');
    item.textContent = '目次はありません';
    tocList.appendChild(item);
  }

  // === 読み進捗インジケーター ===
  function initReadingProgress() {
    const progressBar = document.createElement('div');
    progressBar.className = 'reading-progress';
    progressBar.innerHTML = '<div class="reading-progress-bar"></div>';
    document.body.prepend(progressBar);

    const bar = progressBar.querySelector('.reading-progress-bar');
    const articleContent = document.querySelector('.article-content, .post-article');

    if (!articleContent) return;

    function updateProgress() {
      const articleTop = articleContent.offsetTop;
      const articleHeight = articleContent.offsetHeight;
      const scrollPosition = window.pageYOffset;
      const windowHeight = window.innerHeight;

      const scrollStart = articleTop;
      const scrollEnd = articleTop + articleHeight - windowHeight;

      if (scrollPosition < scrollStart) {
        bar.style.width = '0%';
      } else if (scrollPosition > scrollEnd) {
        bar.style.width = '100%';
      } else {
        const progress = ((scrollPosition - scrollStart) / (scrollEnd - scrollStart)) * 100;
        bar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
      }
    }

    window.addEventListener('scroll', updateProgress, { passive: true });
    window.addEventListener('resize', updateProgress, { passive: true });
    updateProgress();
  }

  initReadingProgress();

  function initResponsiveTocToggle() {
    const tocCard = document.querySelector('.article-card.article-toc');
    const tocListElement = tocCard?.querySelector('[data-toc-list]');
    const label = tocCard?.querySelector('.article-card-label');
    if (!tocCard || !tocListElement || !label) return;
    if (tocCard.dataset.tocToggleInit === 'true') return;
    tocCard.dataset.tocToggleInit = 'true';

    const header = document.createElement('div');
    header.className = 'article-card-header';
    tocCard.insertBefore(header, label);
    header.appendChild(label);

    const panel = document.createElement('div');
    panel.className = 'toc-panel';
    const panelId = 'article-toc-panel';
    panel.id = panelId;
    panel.appendChild(tocListElement);
    tocCard.appendChild(panel);

    if (!tocIndicatorElement) {
      const indicator = document.createElement('p');
      indicator.className = 'toc-current-section';
      indicator.dataset.currentSection = 'true';
      indicator.textContent = '現在位置: -';
      tocCard.insertBefore(indicator, panel);
      tocIndicatorElement = indicator;
    }

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'toc-toggle';
    toggle.setAttribute('aria-controls', panelId);
    toggle.setAttribute('aria-expanded', 'true');
    toggle.textContent = '目次を隠す';
    header.appendChild(toggle);

    const mediaQuery = window.matchMedia('(max-width: 767px)');
    const state = {
      isMobile: mediaQuery.matches,
      expanded: !mediaQuery.matches,
    };

    const updateToggleLabel = () => {
      const labelText = state.expanded ? '目次を隠す' : '目次を表示';
      toggle.textContent = labelText;
      toggle.setAttribute('aria-label', labelText);
    };

    const applyState = () => {
      state.isMobile = mediaQuery.matches;
      if (!state.isMobile) {
        state.expanded = true;
      }
      const shouldShow = !state.isMobile || state.expanded;
      panel.hidden = !shouldShow;
      toggle.setAttribute('aria-expanded', shouldShow ? 'true' : 'false');
      tocCard.dataset.mobileCollapsed = state.isMobile && !state.expanded ? 'true' : 'false';
      updateToggleLabel();
    };

    toggle.addEventListener('click', () => {
      if (!state.isMobile) return;
      state.expanded = !state.expanded;
      applyState();
    });

    const handleMediaChange = () => applyState();
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleMediaChange);
    } else if (typeof mediaQuery.addListener === 'function') {
      mediaQuery.addListener(handleMediaChange);
    }

    applyState();
  }

  // === 目次のアクティブ状態管理 ===
  function initTocHighlight() {
    if (!tocList || headings.length === 0) return;

    const tocItems = Array.from(tocList.querySelectorAll('li[data-section-id]'));
    const sections = Array.from(headings);
    const defaultIndicatorText = '現在位置: -';

    function updateIndicator(item) {
      if (!tocIndicatorElement) return;
      if (!item) {
        tocIndicatorElement.textContent = defaultIndicatorText;
        return;
      }
      const link = item.querySelector('a[data-toc-link="true"]');
      if (!link) return;
      const index = link.querySelector('.toc-index')?.textContent || item.dataset.tocIndex || '';
      const label = link.querySelector('.toc-text')?.textContent || link.textContent || '';
      tocIndicatorElement.textContent = `現在位置: ${index ? `${index} ` : ''}${label.trim()}`;
    }

    function updateActiveToc() {
      const scrollPosition = window.pageYOffset + 120; // ヘッダーオフセット

      let activeSection = null;
      sections.forEach(section => {
        if (section.offsetTop <= scrollPosition) {
          activeSection = section;
        }
      });
      if (!activeSection && sections.length > 0) {
        activeSection = sections[0];
      }

      tocItems.forEach(item => {
        item.classList.remove('active');
        const link = item.querySelector('a[data-toc-link="true"]');
        if (link) {
          link.removeAttribute('aria-current');
        }
      });

      sections.forEach(section => section.classList.remove('toc-target-active'));

      if (activeSection) {
        const activeItem = tocItems.find(item => item.dataset.sectionId === activeSection.id);
        if (activeItem) {
          activeItem.classList.add('active');
          const link = activeItem.querySelector('a[data-toc-link="true"]');
          if (link) {
            link.setAttribute('aria-current', 'true');
          }
          activeSection.classList.add('toc-target-active');
          updateIndicator(activeItem);
          return;
        }
      }

      updateIndicator(null);
    }

    window.addEventListener('scroll', updateActiveToc, { passive: true });
    updateActiveToc();
  }

  initResponsiveTocToggle();
  initTocHighlight();
})();
