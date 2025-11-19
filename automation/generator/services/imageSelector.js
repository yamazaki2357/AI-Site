/**
 * @fileoverview 記事画像選択サービス
 *
 * 記事の内容（タグ、タイトル、トピックキーなど）に基づいて、
 * 登録された画像プールから最適な画像を自動で選択する機能を提供します。
 *
 * 【主な特徴】
 *
 * 1. トピックやカテゴリによるマッチング
 *    - 記事のタグ、タイトル、トピックキーから抽出したキーワードを、
 *      画像に紐づけられたトピックやカテゴリと照合します。
 *    - 例: 「ChatGPT」タグを持つ記事 → 「chatgpt」トピックの画像を優先的に選択
 *
 * 2. 決定論的な選択（再現性の保証）
 *    - 同じ記事内容（シード）であれば、何度実行しても常に同じ画像が選択されます。
 *    - これにより、記事の再生成時に画像が変わってしまうことを防ぎます。
 *    - ハッシュ関数を使用してシードから一意の画像インデックスを計算
 *
 * 3. フォールバック機構
 *    - マッチする画像がない場合、全画像の中から決定論的に1枚選択
 *    - それでも画像が見つからない場合、デフォルト画像を使用
 *
 * 【画像選択の流れ】
 * 1. 記事データからキーワードを収集（タグ、タイトル、トピックキーなど）
 * 2. キーワードにマッチする画像を検索
 * 3. マッチした画像群から、シードを使って決定論的に1枚選択
 * 4. マッチなしの場合、全画像から決定論的に選択
 * 5. 選択した画像情報を整形して返却
 *
 * 【画像マニフェストの構造】
 * `assets/img/articles/index.json` に画像リストが定義されており、各画像には:
 * - key: 画像の識別子
 * - src: 画像ファイルのパス
 * - topics: 関連するトピックのリスト（例: ['chatgpt', 'ai', 'llm']）
 * - category: カテゴリ（例: 'generative-ai'）
 * - isDefault: デフォルト画像かどうか
 */

const { normalizeTagToken } = require('./tokenUtils');

/**
 * 配列（プール）から決定論的に（＝常に同じ結果になるように）要素を1つ選択します。
 *
 * この関数は、同じシード文字列に対して常に同じ要素を返す「決定論的な選択」を実現します。
 * ランダム選択とは異なり、再現性が保証されるため、記事の再生成時にも同じ画像が選ばれます。
 *
 * 【仕組み】
 * 1. シード文字列からハッシュ値を計算
 * 2. ハッシュ値を配列の長さで割った余りをインデックスとして使用
 * 3. そのインデックスの要素を返す
 *
 * 【ハッシュ関数の特性】
 * - 素数31を使用: 衝突を減らし、分散を良くするための標準的なテクニック
 * - 32ビット整数に制限: オーバーフローを防ぎ、一貫した結果を保証
 *
 * 【具体例】
 * pool = ['image1', 'image2', 'image3']
 * seed = 'chatgpt-group-chat'
 *
 * 1. 'chatgpt-group-chat' → ハッシュ値: 1234567890
 * 2. 1234567890 % 3 = 0
 * 3. pool[0] → 'image1' を返す
 *
 * 同じseedで呼び出せば、必ず 'image1' が返される。
 *
 * @param {Array<*>} pool - 選択候補の配列
 * @param {string} [seed=''] - 選択の基準となるシード文字列（例: トピックキーや記事スラグ）
 * @returns {*} 選択された要素。プールが空の場合はnullを返します。
 *
 * @example
 * const images = ['ai-core-01.webp', 'ai-core-02.webp', 'ai-core-03.webp'];
 * deterministicPickFromPool(images, 'chatgpt-group-chat'); // 常に同じ画像を返す
 */
const deterministicPickFromPool = (pool, seed = '') => {
  // プールが空または配列でない場合は null を返す
  if (!Array.isArray(pool) || pool.length === 0) return null;

  // シードを正規化（空の場合はデフォルト値を使用）
  const normalizedSeed = seed ? String(seed) : 'ai-info-blog';

  // ========================================
  // シード文字列から簡易的なハッシュ値を生成
  // ========================================
  let hash = 0;
  for (let i = 0; i < normalizedSeed.length; i += 1) {
    // 31は素数で、ハッシュ値の衝突を減らすためによく使われる定数
    // (hash * 31) + 文字コードの積み重ねでハッシュ値を計算
    hash = (hash * 31 + normalizedSeed.charCodeAt(i)) & 0xffffffff; // 32ビット整数に制限
  }

  // ========================================
  // ハッシュ値を配列のインデックスに変換
  // ========================================
  // 負の数になる可能性があるため、Math.abs()で絶対値を取る
  // 配列の長さで割った余りをインデックスとして使用
  const index = Math.abs(hash) % pool.length;

  return pool[index];
};

/**
 * 記事画像のプールを構築します。
 * マニフェストファイル（`assets/img/articles/index.json`）から画像一覧を読み込み、
 * 検索しやすいように各画像のトピックやカテゴリを正規化します。
 * @param {Function} readJson - JSONファイルを読み込むための関数
 * @param {string} manifestPath - 画像マニフェストファイルのパス
 * @returns {Array<object>} 正規化された画像情報の配列
 */
const buildArticleImagePool = (readJson, manifestPath) => {
  const manifest = readJson(manifestPath, []);
  if (!Array.isArray(manifest)) return [];
  
  return manifest
    .map((item, index) => {
      if (!item || !item.key || !item.src) return null;
      
      // 画像に紐づくトピックを正規化（小文字化、ハイフン化など）
      const topics = Array.isArray(item.topics)
        ? item.topics.map((topic) => normalizeTagToken(topic)).filter(Boolean)
        : [];
        
      return {
        key: item.key,
        src: item.src,
        alt: item.alt || item.label || 'AI情報ブログのビジュアル',
        label: item.label || null,
        description: item.description || null,
        category: normalizeTagToken(item.category) || null,
        topics,
        // isDefaultフラグがあるか、最初の画像をデフォルトとして扱う
        isDefault: Boolean(item.isDefault) || index === 0,
      };
    })
    .filter(Boolean); // 不正なデータをフィルタリング
};

/**
 * 記事と候補のデータから、画像選択のヒントとなるトークン（キーワード）を収集します。
 *
 * この関数は、記事データの様々な場所からキーワードを抽出し、
 * 画像とのマッチングに使用するトークン集合を構築します。
 *
 * 【収集元】
 * 1. 記事のタグ
 *    - タグのslug（例: 'chatgpt'）
 *    - タグのlabel（例: 'ChatGPT'）
 *    - タグのcategory（例: 'ツール'）
 *
 * 2. ソース（チャンネル）の専門分野
 *    - 例: ['ai', 'machine-learning', 'llm']
 *
 * 3. トピックキー
 *    - トピックキー全体（例: 'chatgpt-group-chat'）
 *    - ハイフン/アンダースコアで分割した要素（例: 'chatgpt', 'group', 'chat'）
 *
 * 4. 記事のスラグ
 *    - スラグ全体とその構成要素
 *
 * 5. タイトル（記事・動画）
 *    - スペース、記号で分割した各単語
 *
 * 【トークンの正規化】
 * 全てのトークンは `normalizeTagToken` 関数で正規化されます:
 * - 小文字化
 * - Unicode正規化（NFKC）
 * - 前後のトリミング
 *
 * これにより、大文字・小文字や全角・半角の違いを無視してマッチングできます。
 *
 * 【重複の除去】
 * Setを使用しているため、同じトークンは1回だけ記録されます。
 *
 * @param {object} article - 生成された記事データ
 * @param {object} candidate - 元となった候補データ
 * @returns {Set<string>} 収集・正規化されたトークンのSet
 *
 * @example
 * const tokens = gatherImageTokens(
 *   { title: 'ChatGPT Group Chat機能', tags: [{ slug: 'chatgpt', label: 'ChatGPT' }] },
 *   { topicKey: 'chatgpt-group-chat', source: { focus: ['ai', 'llm'] } }
 * );
 * // tokens => Set { 'chatgpt', 'group', 'chat', 'ai', 'llm', ... }
 */
const gatherImageTokens = (article, candidate) => {
  const tokens = new Set(); // 重複を自動的に除去するためSetを使用

  /**
   * トークンを正規化してSetに追加するヘルパー関数
   * @param {*} value - 追加する値
   */
  const pushToken = (value) => {
    const normalized = normalizeTagToken(value);
    if (normalized) tokens.add(normalized);
  };

  // ========================================
  // 1. 記事のタグからトークンを収集
  // ========================================
  if (article?.tags) {
    article.tags.forEach((tag) => {
      if (!tag) return;

      // タグが文字列の場合（古い形式）
      if (typeof tag === 'string') {
        pushToken(tag);
        return;
      }

      // タグがオブジェクトの場合（新形式）
      pushToken(tag.slug);      // 例: 'chatgpt'
      pushToken(tag.label);     // 例: 'ChatGPT'
      pushToken(tag.category);  // 例: 'ツール' → 'tool'
    });
  }

  // ========================================
  // 2. 候補のソース（チャンネル）の専門分野からトークンを収集
  // ========================================
  if (candidate?.source?.focus) {
    candidate.source.focus.forEach(pushToken);
  }

  // ========================================
  // 3. トピックキーとその構成要素からトークンを収集
  // ========================================
  if (candidate?.topicKey) {
    // トピックキー全体を追加
    pushToken(candidate.topicKey);

    // ハイフンやアンダースコアで分割して各要素も追加
    // 例: 'chatgpt-group-chat' → ['chatgpt', 'group', 'chat']
    candidate.topicKey.split(/[-_]+/).forEach(pushToken);
  }

  // ========================================
  // 4. 記事のスラグとその構成要素からトークンを収集
  // ========================================
  if (article?.slug) {
    pushToken(article.slug);
    article.slug.split(/[-_]+/).forEach(pushToken);
  }

  // ========================================
  // 5. 記事と動画のタイトルからトークンを収集
  // ========================================
  /**
   * タイトル文字列を分割してトークンを抽出するヘルパー関数
   * @param {string} title - タイトル文字列
   */
  const injectFromTitle = (title) => {
    if (!title) return;

    // スペース、中黒（・）、スラッシュ、句読点などで分割
    title
      .split(/[\s・／/、。:+\-]+/)
      .map((token) => token.trim())
      .forEach(pushToken);
  };

  injectFromTitle(article?.title);         // 記事タイトル
  injectFromTitle(candidate?.video?.title); // 元動画のタイトル

  return tokens;
};

/**
 * 画像選択サービスのファクトリ関数。
 * 依存関係（`readJson`関数とマニフェストパス）を注入して、`selectArticleImage`関数を生成します。
 * @param {{readJson: Function, manifestPath: string}} dependencies - 依存関係
 * @returns {{selectArticleImage: Function}} `selectArticleImage`メソッドを持つオブジェクト
 */
const createImageSelector = ({ readJson, manifestPath }) => {
  // サービス初期化時に画像プールを構築
  const articleImagePool = buildArticleImagePool(readJson, manifestPath);
  // デフォルト画像を設定
  const defaultArticleImage =
    articleImagePool.find((item) => item.isDefault) || articleImagePool[0] || null;

  /**
   * 記事データと候補データに基づいて、最適な画像を1枚選択します。
   * @param {object} article - 生成された記事データ
   * @param {object} candidate - 元となった候補データ
   * @returns {object|null} 選択された画像情報、またはnull
   */
  const selectArticleImage = (article, candidate) => {
    if (!articleImagePool.length) return null;
    
    // 1. 記事内容からトークンを収集
    const tokens = gatherImageTokens(article, candidate);
    
    // 2. トークンにマッチする画像をプールから検索
    const matched = articleImagePool.filter((entry) => {
      if (!entry) return false;
      // 画像のトピックかカテゴリが、収集したトークンに含まれているかチェック
      if (entry.topics.some((topic) => tokens.has(topic))) return true;
      if (entry.category && tokens.has(entry.category)) return true;
      return false;
    });
    
    // 3. 決定論的な選択のためのシードを決定
    const seed =
      candidate?.topicKey || article?.slug || article?.title || candidate?.id || 'ai-info';
      
    // 4. マッチした画像があればその中から、なければ全画像の中から決定論的に1枚選択
    const pool = matched.length > 0 ? matched : articleImagePool;
    const picked = deterministicPickFromPool(pool, seed) || defaultArticleImage;
    
    if (!picked) return null;
    
    // 5. 最終的な画像情報を整形して返す
    return {
      key: picked.key,
      src: picked.src,
      alt: picked.alt,
      label: picked.label,
      caption: picked.description || picked.label || '',
      category: picked.category,
    };
  };

  return { selectArticleImage };
};

module.exports = {
  createImageSelector,
};