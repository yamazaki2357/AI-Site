// ============================================
// AI情報ブログ - インタラクティブUI v2.0
// ============================================

// === スクロール時のヘッダー効果 ===
(function initHeaderScroll() {
  const header = document.querySelector('.site-header');
  let lastScroll = 0;
  const scrollThreshold = 50;

  window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;

    if (currentScroll > scrollThreshold) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }

    lastScroll = currentScroll;
  }, { passive: true });
})();

// === スムーズスクロールアニメーション ===
(function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#') return;

      e.preventDefault();
      const target = document.querySelector(href);

      if (target) {
        const headerOffset = 80;
        const elementPosition = target.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

        window.scrollTo({
          top: offsetPosition,
          behavior: 'smooth'
        });
      }
    });
  });
})();

// === インターセクションオブザーバー（要素のフェードイン） ===
(function initScrollAnimations() {
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);

  // アニメーション対象要素を監視
  const animateElements = document.querySelectorAll(
    '.post-card, .workflow-card, .source-card, .info-panel, .hero-panel'
  );

  animateElements.forEach(el => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(20px)';
    el.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';
    observer.observe(el);
  });
})();

// === 記事一覧の読み込み ===
(function loadPosts() {
  const list = document.getElementById('post-list');
  const errorLabel = document.getElementById('post-error');

  if (!list) return;

  const formatDate = (isoString) => {
    if (!isoString) return '';
    const normalized = isoString.replaceAll('/', '-');
    const date = new Date(`${normalized}T00:00:00`);
    if (Number.isNaN(date.getTime())) return isoString;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}.${m}.${d}`;
  };

  const renderPosts = (posts) => {
    list.innerHTML = '';

    posts.forEach((post, index) => {
      const item = document.createElement('li');
      item.className = 'post-card';

      // スタガードアニメーション（順次表示）
      item.style.animationDelay = `${index * 0.1}s`;

      const tags = Array.isArray(post.tags) ? post.tags : [];
      const tagMarkup = tags.length
        ? `<ul class="tag-list">${tags.map((tag) => `<li class="tag">${tag}</li>`).join('')}</ul>`
        : '';

      item.innerHTML = `
        <div class="post-meta">${formatDate(post.date)}</div>
        <h3><a href="${post.url}">${post.title}</a></h3>
        <p class="post-summary">${post.summary ?? ''}</p>
        ${tagMarkup}
      `;

      // カード全体をクリック可能に
      item.addEventListener('click', (e) => {
        if (e.target.tagName !== 'A') {
          const link = item.querySelector('h3 a');
          if (link) link.click();
        }
      });

      list.appendChild(item);
    });

    // 追加後にアニメーション監視を再実行
    setTimeout(() => {
      const cards = list.querySelectorAll('.post-card');
      cards.forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = 'opacity 0.6s ease-out, transform 0.6s ease-out';

        // すぐに表示開始
        requestAnimationFrame(() => {
          card.style.opacity = '1';
          card.style.transform = 'translateY(0)';
        });
      });
    }, 10);
  };

  // スケルトンローダーの表示
  const showSkeleton = () => {
    list.innerHTML = Array(3).fill(0).map(() => `
      <li class="post-card skeleton">
        <div class="skeleton-line"></div>
        <div class="skeleton-line"></div>
        <div class="skeleton-line short"></div>
      </li>
    `).join('');
  };

  showSkeleton();

  fetch('data/posts.json', { cache: 'no-cache' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((posts) => {
      const sorted = [...posts].sort((a, b) => new Date(b.date) - new Date(a.date));

      // データ取得後、少し遅延させて表示（UX向上）
      setTimeout(() => {
        renderPosts(sorted);
        if (errorLabel) errorLabel.textContent = '';
      }, 300);
    })
    .catch((error) => {
      console.error('記事一覧の読み込みに失敗しました', error);
      if (errorLabel) {
        errorLabel.textContent = '記事一覧の読み込みに失敗しました。時間をおいて再度お試しください。';
      }
      list.innerHTML = '';
    });
})();

// === 監視対象チャンネルの読み込み ===
(function loadSources() {
  const list = document.getElementById('source-list');
  const counter = document.getElementById('source-count');
  const errorLabel = document.getElementById('source-error');

  if (!list || !counter) return;

  const renderSources = (sources) => {
    list.innerHTML = '';

    sources.forEach((source, index) => {
      const item = document.createElement('li');
      item.className = 'source-card';
      item.style.animationDelay = `${index * 0.05}s`;

      const focus = Array.isArray(source.focus) ? source.focus.join(', ') : '';

      item.innerHTML = `
        <p class="source-meta">${source.platform ?? 'YouTube'}</p>
        <h3>${source.name ?? 'No title'}</h3>
        <a href="${source.url}" target="_blank" rel="noopener noreferrer">${source.url}</a>
        <p class="source-meta">${focus}</p>
      `;

      list.appendChild(item);
    });

    // 追加後にアニメーション
    setTimeout(() => {
      const cards = list.querySelectorAll('.source-card');
      cards.forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = 'opacity 0.5s ease-out, transform 0.5s ease-out';

        requestAnimationFrame(() => {
          card.style.opacity = '1';
          card.style.transform = 'translateY(0)';
        });
      });
    }, 10);
  };

  // カウントアップアニメーション
  const animateCounter = (target, end) => {
    const duration = 1000;
    const start = 0;
    const startTime = performance.now();

    const updateCounter = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // イージング関数（ease-out）
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(start + (end - start) * easeOut);

      target.textContent = current;

      if (progress < 1) {
        requestAnimationFrame(updateCounter);
      } else {
        target.textContent = end;
      }
    };

    requestAnimationFrame(updateCounter);
  };

  fetch('data/sources.json', { cache: 'no-cache' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((sources) => {
      renderSources(sources);
      animateCounter(counter, sources.length);
      if (errorLabel) errorLabel.textContent = '';
    })
    .catch((error) => {
      console.error('監視対象の読み込みに失敗しました', error);
      if (errorLabel) {
        errorLabel.textContent = '監視対象リストの読み込みに失敗しました。';
      }
      list.innerHTML = '';
      counter.textContent = '0';
    });
})();

// === パフォーマンス最適化: Passive Event Listeners ===
(function optimizeScrollPerformance() {
  // すべてのホバー効果をGPU加速
  const cards = document.querySelectorAll('.post-card, .workflow-card, .source-card');
  cards.forEach(card => {
    card.style.willChange = 'transform';
  });
})();

// === アクセシビリティ: キーボードナビゲーション ===
(function enhanceAccessibility() {
  // カードにキーボード操作を追加
  document.querySelectorAll('.post-card').forEach(card => {
    card.setAttribute('tabindex', '0');
    card.setAttribute('role', 'article');

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const link = card.querySelector('a');
        if (link) link.click();
      }
    });
  });
})();

// === ページロード完了時の初期化 ===
window.addEventListener('DOMContentLoaded', () => {
  // フォーカス可視性の強化
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      document.body.classList.add('keyboard-navigation');
    }
  });

  document.addEventListener('mousedown', () => {
    document.body.classList.remove('keyboard-navigation');
  });
});

// === プリロードとパフォーマンス最適化 ===
(function optimizePerformance() {
  // 重要なフォントをプリロード
  const preloadFont = (url) => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'font';
    link.crossOrigin = 'anonymous';
    link.href = url;
    document.head.appendChild(link);
  };

  // 画像の遅延読み込み
  const images = document.querySelectorAll('img[data-src]');
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.src = img.dataset.src;
          img.removeAttribute('data-src');
          imageObserver.unobserve(img);
        }
      });
    });

    images.forEach(img => imageObserver.observe(img));
  } else {
    // フォールバック
    images.forEach(img => {
      img.src = img.dataset.src;
    });
  }
})();

console.log('🎨 AI情報ブログ v2.0 - デザインシステム初期化完了');
