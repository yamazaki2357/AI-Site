/**
 * 定数管理
 * プロジェクト全体で使用する定数を一元管理
 */

// Collector関連
const COLLECTOR = {
  MAX_PER_CHANNEL: 2,
  VIDEO_LOOKBACK_DAYS: 7,
  SEARCH_PAGE_SIZE: 10,
  CLEANUP_PROCESSED_DAYS: 14,
  MAX_PENDING_CANDIDATES: 30, // collected/researched状態の候補の最大保持数
};

// Researcher関連
const RESEARCHER = {
  GOOGLE_TOP_LIMIT: 3,
  ARTICLE_FETCH_TIMEOUT_MS: 15000,
  ARTICLE_TEXT_MAX_LENGTH: 20000,
  SUMMARY_MIN_LENGTH: 500,
  SUMMARY_MAX_LENGTH: 800,
  USER_AGENT: 'AIInfoBlogCollector/1.0 (+https://github.com/gray-desk/AI-information-blog)',
};

// Generator関連
const GENERATOR = {
  DEDUPE_WINDOW_DAYS: 5,
};

// レート制限
const RATE_LIMITS = {
  KEYWORD_EXTRACTION_WAIT_MS: 500,
  GOOGLE_SEARCH_WAIT_MS: 500,
  CANDIDATE_PROCESSING_WAIT_MS: 1000,
  SEARCH_RESULT_WAIT_MS: 500,
};

// 検証関連
const VALIDATION = {
  ORPHAN_POST_CHECK_ENABLED: true,
  ORPHAN_POST_IGNORE: ['article-template.html'],
};

module.exports = {
  COLLECTOR,
  RESEARCHER,
  GENERATOR,
  RATE_LIMITS,
  VALIDATION,
};
