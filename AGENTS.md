# AGENTS

このリポジトリは「AI情報ブログ」の自動記事生成パイプライン（Collector → Researcher → Generator → Publisher）と静的サイト一式を管理しています。以降の作業を行うエージェントは、プロジェクトの現状をふまえて以下を厳守してください。

## 共通ルール
- すべての説明・コミットメッセージ・レビューは日本語で行う。
- OpenAI / Google Search / YouTube などのシークレットはローカルに置かず、GitHub Secrets を利用する前提で記述やコマンドを提案する。
- 変更対象は原則 `automation/`、`data/`、`posts/`、`index.html` などリポジトリ内のファイルのみ。既存の未コミット変更には触れない。
- 自動生成物（`posts/` 内の公開HTMLや `automation/output/pipeline-status.json`）を手動で書き換える場合は理由を記述し、極力再現手順を残す。

## 設定管理（重要）

### `automation/config/` ディレクトリ

プロジェクト全体の設定は `automation/config/` で一元管理されています。**ハードコードされた定数やプロンプトは存在しません**。

#### `automation/config/constants.js`
ステージ固有の定数を定義します。値を変更する際は必ずこのファイルを編集してください。

```javascript
COLLECTOR: {
  MAX_PER_CHANNEL: 2,              // チャンネルごとの最大取得数
  VIDEO_LOOKBACK_DAYS: 7,          // 動画取得の遡及日数
  SEARCH_PAGE_SIZE: 10,            // YouTube検索ページサイズ
  CLEANUP_PROCESSED_DAYS: 14,      // 処理済み候補のクリーンアップ日数
  MAX_PENDING_CANDIDATES: 30,      // collected/researched状態の候補の最大数
}

RESEARCHER: {
  GOOGLE_TOP_LIMIT: 3,             // Google検索で取得する上位記事数
  ARTICLE_FETCH_TIMEOUT_MS: 15000, // 記事本文取得のタイムアウト
  ARTICLE_TEXT_MAX_LENGTH: 20000,  // 記事本文の最大文字数
  SUMMARY_MIN_LENGTH: 500,         // 要約の最小文字数
  SUMMARY_MAX_LENGTH: 800,         // 要約の最大文字数
}

GENERATOR: {
  DEDUPE_WINDOW_DAYS: 5,           // 重複判定のウィンドウ日数
}

RATE_LIMITS: {
  KEYWORD_EXTRACTION_WAIT_MS: 500,
  CANDIDATE_PROCESSING_WAIT_MS: 1000,
  SEARCH_RESULT_WAIT_MS: 500,
}
```

#### `automation/config/models.js`
OpenAI APIのモデルとパラメータを定義します。

```javascript
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
- `ARTICLE_GENERATION`: 記事生成用プロンプト（**高度な技術背景を持つ読者向け**）

**重要**: プロンプト変更時は `automation/config/prompts.js` のみを編集してください。各ステージのファイルには直接記述されていません。

#### `automation/lib/openai.js`
OpenAI API呼び出しの統一ユーティリティです。すべてのステージで `callOpenAI()` 関数を使用しています。

```javascript
const { callOpenAI, extractContent } = require('../lib/openai');

const completion = await callOpenAI({
  apiKey,
  messages,
  model: SUMMARY_GENERATION.model,
  temperature: SUMMARY_GENERATION.temperature,
  maxTokens: SUMMARY_GENERATION.max_tokens,
});

const summary = extractContent(completion);
```

**直接 `fetch()` を使用しないでください**。エラーハンドリングとレート制限が統一されています。

---

## パイプライン構成

現在のパイプラインは **4ステージ** で構成されています：

```
YouTube動画 → Collector → Researcher → Generator → Publisher → 公開記事
             (collected)  (researched)  (generated)  (published)
```

各ステージは独立して実行可能で、`data/candidates.json` の `status` フィールドで状態管理されています。

---

## 役割ごとの方針

### 1. Collector サポート

**責任**: YouTube Data API v3 から最新動画を取得

**入力**:
- `data/sources.json` (監視対象YouTubeチャンネル)

**処理**:
- YouTube Data API v3 で最新動画を取得
- 7日以内の動画をフィルタリング（`VIDEO_LOOKBACK_DAYS`）
- チャンネルごとに最大2件まで取得（`MAX_PER_CHANNEL`）
- 重複チェック

**出力**:
- `data/candidates.json` に `status: "collected"` で保存

**環境変数**:
- `YOUTUBE_API_KEY` (必須)

**注意点**:
- ソースは `data/sources.json` を単一の真実源とする
- YouTubeチャンネルを追加する際は必ず `channelId` を記載する（ハンドルだけでは動作しない）
- 定数を変更する場合は `automation/config/constants.js` の `COLLECTOR` セクションを編集
- APIキー欠落時は即座にエラーを投げる

**実装**: `automation/collector/index.js`

---

### 2. Researcher サポート（新規ステージ）

**責任**: 動画情報からキーワードを抽出し、Google検索で関連記事をリサーチ

**入力**:
- `data/candidates.json` の `status: "collected"` の候補

**処理**:
1. OpenAI API (gpt-4o-mini) で動画タイトル・説明文からキーワード抽出
2. 抽出キーワードでGoogle Custom Search API実行
3. 検索結果の上位3件を取得（`GOOGLE_TOP_LIMIT`）
4. 各記事の本文を取得（15秒タイムアウト、最大20,000文字）
5. OpenAI API (gpt-4o) で500〜800文字の要約生成
   - 必須要素4項目：技術的発見、具体的な数値、実装上の制約、今後の展望

**出力**:
- `data/candidates.json` に `status: "researched"` で保存
  - `searchQuery`: { original, extracted, method }
  - `searchSummaries`: [{ title, url, snippet, summary }]

**環境変数**:
- `OPENAI_API_KEY` (必須)
- `GOOGLE_SEARCH_API_KEY` (必須)
- `GOOGLE_SEARCH_CX` (必須)

**注意点**:
- 要約は500〜800文字で、技術的詳細を含む
- AI要約失敗時は記事本文から抽出したテキストをフォールバックとして使用
- Google検索失敗時は空配列で継続（Generator側でハンドリング）
- 定数を変更する場合は `automation/config/constants.js` の `RESEARCHER` セクションを編集
- プロンプトを変更する場合は `automation/config/prompts.js` の `SUMMARY_GENERATION` セクションを編集

**実装**: `automation/researcher/index.js`

**メトリクス**:
- キーワード抽出成功率
- Google検索成功率
- 平均処理時間（キーワード抽出・Google検索）

---

### 3. Generator サポート

**責任**: リサーチデータから記事を生成

**入力**:
- `data/candidates.json` の `status: "researched"` の候補（**pendingではありません**）
- `data/posts.json`
- `data/topic-history.json`
- `data/tags.json`

**処理**:
1. 重複トピック判定（5日以内、`DEDUPE_WINDOW_DAYS`）
2. OpenAI API (gpt-4o) で記事生成（JSON形式）
3. タグマッピング（`data/tags.json` 参照）
4. HTMLファイル生成
5. `data/topic-history.json` に記録

**出力**:
- `data/candidates.json` に `status: "generated"` で保存
- 記事データ（title, summary, intro, sections, conclusion, tags）

**環境変数**:
- `OPENAI_API_KEY` (必須)

**注意点**:
- 対象は `status: "researched"` の候補（以前は `"pending"` だったが、Researcher導入後に変更）
- 記事は **高度な技術背景を持つ読者** 向けに生成（YouTubeのテック系コンテンツを日常的に視聴する層）
- 基本的なIT用語の説明は不要、専門用語を積極的に使用
- Google検索リサーチ要約がない場合でも動画情報のみで記事生成を試みる
- エラーハンドリングが実装されており、API失敗時は `status: "failed"` に変更
- 定数を変更する場合は `automation/config/constants.js` の `GENERATOR` セクションを編集
- プロンプトを変更する場合は `automation/config/prompts.js` の `ARTICLE_GENERATION` セクションを編集

**実装**: `automation/generator/index.js`

---

### 4. Publisher サポート

**責任**: 生成された記事を公開ファイルとして出力

**入力**:
- `data/candidates.json` の `status: "generated"` の候補

**処理**:
1. HTMLファイルを `posts/<slug>.html` に保存
2. `data/posts.json` に記事メタデータを追加（日付降順で整列）
3. 候補を `status: "published"` に変更

**出力**:
- `posts/<slug>.html` (公開用HTMLファイル)
- `data/posts.json` (更新)
- `data/candidates.json` (status更新)

**注意点**:
- 生成HTMLは generator から publisher へ直接渡される
- フィールド追加時は `posts/` 内の実ページと `index.html` のレンダリングに影響するので schema を必ず更新
- パイプラインサマリーは `automation/output/pipeline-status.json` に保存し、静的サイトが直接読み出す
- キー名の変更は `index.html` 側のフェッチ処理も要修正
- 手動で `posts/` にHTML記事を追加した場合は、同じSlugとURLで `data/posts.json` にエントリを必ず追加する。Publisherは `posts/` を検証し、未登録ファイルがあると `pipeline-status.json` の `validation.warnings` とコンソールログで警告を出す。

**実装**: `automation/publisher/index.js`

---

## 手動オペレーションチェックリスト

- **エラー確認**: `automation/output/pipeline-status.json` でCollector/Researcher/Generator/Publisherのエラーを確認
- **ログ確認**: Researcherステージは `automation/output/researcher/researcher-<date>.json` にメトリクスを出力
- **記事確認**: `posts/` と `data/posts.json` の差分を突き合わせ、Slug 重複や投稿日欠落がないかを確認
- **候補のステータス確認**: `data/candidates.json` で各候補の `status` が正しく遷移しているか確認
  - collected → researched → generated → published
  - 失敗時は `status: "failed"` に変更される
- **静的サイト確認**: `index.html` と `about.html` はプレーンHTML構成のため、ビルドステップ無しでブラウザ確認

---

## 参考コマンド

### パイプライン実行
```bash
# パイプライン全体のローカル実行
node automation/pipeline/index.js

# 各ステージを個別に実行
node automation/collector/index.js
node automation/researcher/index.js
node automation/generator/index.js
node automation/publisher/index.js
```

### GitHub Actions
`.github/workflows/content-pipeline.yml` では `node automation/pipeline/index.js` を実行して自動コミットします。手動テスト時も同コマンドで再現し、生成物は `git status` で確認してください。

---

## トラブルシューティング

### 1. Researcher がキーワード抽出に失敗する
- フォールバック: 元の動画タイトルを使用
- 確認: `OPENAI_API_KEY` が正しく設定されているか
- ログ: `automation/output/researcher/researcher-<date>.json` の `keywordExtraction.fallbackUsed` を確認

### 2. Researcher が Google検索に失敗する
- フォールバック: 空配列で継続（Generator側で動画情報のみで記事生成）
- 確認: `GOOGLE_SEARCH_API_KEY` と `GOOGLE_SEARCH_CX` が正しく設定されているか
- 制限: Google Custom Search API は1日100クエリの無料枠制限あり

### 3. Generator が記事生成に失敗する
- エラーハンドリング: `status: "failed"` に変更し、`errorMessage` を記録
- 確認: `OPENAI_API_KEY` が正しく設定されているか
- 確認: `searchSummaries` が空でないか（空でも生成を試みるが品質が低下）

### 4. 設定変更が反映されない
- 確認: `automation/config/` ディレクトリのファイルを編集したか
- 確認: 各ステージのファイルに直接ハードコードしていないか
- 再実行: パイプラインを再実行（設定は実行時に読み込まれる）

---

## その他

### ブランチポリシー
- ブランチポリシーやデプロイ戦略に変更があれば、このファイルを更新して最新手順に同期させる。

### 記事構造
- 記事本文は SEO 向けの sections/subSections を含む JSON を元にHTML化している。
- 構造を変更した際は必ず `automation/templates/` と `posts/` の最終HTMLの整合を確認。

### 読者レベル設定
- 記事は「高度な技術背景を持つ読者（YouTubeのテック系コンテンツを日常的に視聴）」向けに生成されます。
- 基本的なIT用語の説明は不要、専門用語を積極的に使用します。
- プロンプトを変更する場合は `automation/config/prompts.js` を編集してください。

### データフロー
```
YouTube動画
  ↓ Collector (YouTube Data API)
data/candidates.json (status: collected)
  ↓ Researcher (OpenAI + Google Search)
data/candidates.json (status: researched, searchSummaries追加)
  ↓ Generator (OpenAI)
data/candidates.json (status: generated)
  ↓ Publisher
posts/<slug>.html + data/posts.json + data/candidates.json (status: published)
```
