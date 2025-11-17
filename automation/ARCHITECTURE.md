# パイプラインアーキテクチャ

## 概要

記事生成パイプラインは、4つの独立したステージで構成されています。
各ステージは単一の責任を持ち、データを段階的に処理します。

```
YouTube動画 → Collector → Researcher → Generator → Publisher → 公開記事
```

## 設定管理

### config/ ディレクトリ構造

プロジェクト全体の設定を一元管理するため、以下のファイルを使用しています：

#### `automation/config/constants.js`
ステージ固有の定数を定義します。

```javascript
COLLECTOR: {
  MAX_PER_CHANNEL: 2,              // チャンネルごとの最大取得数
  VIDEO_LOOKBACK_DAYS: 7,          // 動画取得の遡及日数
  SEARCH_PAGE_SIZE: 10,            // YouTube検索ページサイズ
  CLEANUP_PROCESSED_DAYS: 14,      // 処理済み候補のクリーンアップ日数
  MAX_PENDING_CANDIDATES: 30,      // pending状態の候補の最大数
}

RESEARCHER: {
  GOOGLE_TOP_LIMIT: 3,             // Google検索で取得する上位記事数
  ARTICLE_FETCH_TIMEOUT_MS: 15000, // 記事本文取得のタイムアウト
  ARTICLE_TEXT_MAX_LENGTH: 20000,  // 記事本文の最大文字数
  SUMMARY_MIN_LENGTH: 500,         // 要約の最小文字数
  SUMMARY_MAX_LENGTH: 800,         // 要約の最大文字数
  USER_AGENT: '...',               // HTTPリクエストのUser-Agent
}

GENERATOR: {
  DEDUPE_WINDOW_DAYS: 5,           // 重複判定のウィンドウ日数
}

RATE_LIMITS: {
  KEYWORD_EXTRACTION_WAIT_MS: 500,
  GOOGLE_SEARCH_WAIT_MS: 500,
  CANDIDATE_PROCESSING_WAIT_MS: 1000,
  SEARCH_RESULT_WAIT_MS: 500,
}
```

#### `automation/config/models.js`
OpenAI APIのモデルとパラメータを定義します。

```javascript
OPENAI_API_URL: 'https://api.openai.com/v1/chat/completions'
YOUTUBE_API_BASE: 'https://www.googleapis.com/youtube/v3'

KEYWORD_EXTRACTION: {
  model: 'gpt-4o-mini',
  temperature: 0.3,
  max_tokens: 100,
}

SUMMARY_GENERATION: {
  model: 'gpt-4o',
  temperature: 0.3,
  max_tokens: 800,
}

ARTICLE_GENERATION: {
  model: 'gpt-4o',
  temperature: 0.4,
  response_format: { type: 'json_object' },
}
```

#### `automation/config/prompts.js`
全ステージのシステムプロンプトとユーザープロンプトを定義します。

- `KEYWORD_EXTRACTION`: キーワード抽出用プロンプト
- `SUMMARY_GENERATION`: 記事要約生成用プロンプト（必須要素4項目を明記）
- `ARTICLE_GENERATION`: 記事生成用プロンプト（高度な技術背景を持つ読者向け）

**設定の目的**:
- 本番環境での値調整を容易に
- ステージ間での設定の一貫性を確保
- プロンプトのバージョン管理を明確化
- リーダビリティの向上

---

## ステージ構成

### 1. Collector (YouTube動画収集)
**責任**: YouTube Data APIから最新動画を取得

**入力**:
- `data/sources.json` (監視対象YouTubeチャンネル)

**処理**:
- YouTube Data API v3で最新動画を取得
- 7日以内の動画をフィルタリング
- チャンネルごとに最大2件まで取得
- 重複チェック

**出力**:
- `data/candidates.json` (status: `collected`)

**環境変数**:
- `YOUTUBE_API_KEY`

**実装**: `automation/collector/index.js`

---

### 2. Researcher (キーワード抽出 + Google検索)
**責任**: 動画情報からキーワードを抽出し、関連記事を検索

**入力**:
- `data/candidates.json` (status: `collected`)

**処理**:
1. OpenAI APIで動画タイトル・説明文からキーワード抽出
2. 抽出キーワードでGoogle Custom Search API実行
3. 検索結果の上位3件を取得
4. 各記事の本文を取得・要約生成

**出力**:
- `data/candidates.json` (status: `researched`)
  - `searchQuery`: { original, extracted, method }
  - `searchSummaries`: [{ title, url, snippet, summary }]

**環境変数**:
- `OPENAI_API_KEY`
- `GOOGLE_SEARCH_API_KEY`
- `GOOGLE_SEARCH_CX`

**実装**: `automation/researcher/index.js`

**メトリクス**:
- キーワード抽出成功率
- Google検索成功率
- 平均処理時間

---

### 3. Generator (記事生成)
**責任**: リサーチデータから記事を生成

**入力**:
- `data/candidates.json` (status: `researched`)
- `data/posts.json`
- `data/topic-history.json`
- `data/tags.json`

**処理**:
1. 重複トピック判定（5日以内）
2. OpenAI API (gpt-4o)で記事生成
3. HTMLファイル生成
4. タグマッピング

**出力**:
- `posts/{date}-{slug}.html`
- `data/candidates.json` (status: `generated`)
- `data/topic-history.json` (更新)

**環境変数**:
- `OPENAI_API_KEY`

**実装**: `automation/generator/index.js`

---

### 4. Publisher (公開)
**責任**: 生成記事をサイトに公開

**入力**:
- Generator からの記事データ
- `data/posts.json`

**処理**:
1. HTMLファイルを `posts/` ディレクトリに保存
2. `data/posts.json` に記事メタデータを追加
3. インデックスページの更新

**出力**:
- `posts/{date}-{slug}.html`
- `data/posts.json` (更新)
- `automation/output/pipeline-status.json`

**実装**: `automation/publisher/index.js`

---

## データフロー

### ステータス遷移

```
collected → researched → generated → published
    ↓           ↓            ↓
(Collector) (Researcher) (Generator)
```

### candidates.json のデータ構造

```json
{
  "id": "yt-{videoId}",
  "status": "collected | researched | generated | published | skipped",
  "source": {
    "platform": "YouTube",
    "name": "チャンネル名",
    "channelId": "UC...",
    "url": "https://...",
    "focus": ["テックニュース", "生成AI"]
  },
  "video": {
    "id": "videoId",
    "title": "動画タイトル",
    "url": "https://youtube.com/watch?v=...",
    "description": "動画説明",
    "thumbnail": "https://...",
    "publishedAt": "2025-11-17T12:00:00Z"
  },
  "searchQuery": {
    "original": "元の動画タイトル",
    "extracted": "抽出されたキーワード",
    "method": "openai | fallback"
  },
  "searchSummaries": [
    {
      "title": "記事タイトル",
      "url": "https://...",
      "snippet": "Googleスニペット",
      "summary": "本文から生成した要約（300-500文字）"
    }
  ],
  "topicKey": "slug化されたトピック",
  "createdAt": "2025-11-17T12:00:00.000Z",
  "updatedAt": "2025-11-17T12:05:00.000Z",
  "researchedAt": "2025-11-17T12:05:00.000Z",
  "generatedAt": "2025-11-17T12:10:00.000Z"
}
```

## パイプライン実行

### 自動実行 (GitHub Actions)
```yaml
# .github/workflows/content-pipeline.yml
schedule:
  - cron: '0 0 * * *'  # 09:00 JST
  - cron: '0 12 * * *' # 21:00 JST
```

### 手動実行
```bash
# 全パイプライン実行
node automation/pipeline/index.js

# 個別ステージ実行
node automation/collector/index.js   # Collectorのみ
node automation/researcher/index.js  # Researcherのみ
node automation/generator/index.js   # Generatorのみ
```

## 失敗時の再実行戦略

### Collector失敗
→ 再実行すれば最初からやり直し（YouTube APIのみ）

### Researcher失敗
→ `status=collected` の候補のみ再処理
→ YouTube API呼び出し不要

### Generator失敗
→ `status=researched` の候補のみ再処理
→ YouTube API・Google Search API呼び出し不要

### Publisher失敗
→ `status=generated` の候補のみ再処理
→ すべてのAPI呼び出し不要

## メトリクス監視

各ステージは以下のメトリクスを出力：

### Collector
- チェックしたソース数
- 発見した動画数
- 新規追加数
- 重複スキップ数

### Researcher
- 処理候補数
- キーワード抽出成功/失敗/フォールバック数
- Google検索成功/失敗数
- 平均処理時間（キーワード抽出・Google検索）

### Generator
- 記事生成成功/失敗
- 重複トピックスキップ数

### Publisher
- 公開成功/失敗

## エラーハンドリング

### レート制限対策
- OpenAI API呼び出し後: 500ms待機
- 候補間の処理: 1000ms待機
- Google検索結果間: 150ms待機

### フォールバック戦略
1. キーワード抽出失敗 → 元の動画タイトルを使用
2. Google検索失敗 → 空配列で継続
3. 記事本文取得失敗 → Googleスニペットで代替

## ベストプラクティス

### ✅ DO
- 各ステージを独立して実行可能に保つ
- ステータス遷移を明確に記録
- メトリクスを詳細にログ出力
- エラー時はフォールバックを提供

### ❌ DON'T
- ステージ間で直接データを受け渡さない（ファイルベースで）
- 処理済みステータスを上書きしない
- API呼び出しを並列化しすぎない（レート制限）
- エラーを握りつぶさない（必ずログ出力）

## トラブルシューティング

### 候補が処理されない
1. `data/candidates.json` でステータス確認
2. 該当ステータスのステージを個別実行
3. ログで詳細なエラー確認

### API制限エラー
1. メトリクスで失敗率を確認
2. 待機時間を調整
3. 処理件数を削減（MAX_PER_CHANNEL等）

### 重複記事が生成される
1. `topic-history.json` の確認
2. DEDUPE_WINDOW_DAYS の調整
3. slugify ロジックの確認
