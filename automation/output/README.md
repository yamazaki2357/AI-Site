# パイプライン成果物ディレクトリ

このディレクトリには、各パイプラインステージの実行結果が日次で保存されます。

## ディレクトリ構造

```
automation/output/
├── collector/           # Collectorステージの成果物
│   ├── .gitkeep
│   └── collector-YYYY-MM-DD.json
├── researcher/          # Researcherステージの成果物
│   ├── .gitkeep
│   └── researcher-YYYY-MM-DD.json
├── generator/           # Generatorステージの成果物 (予約)
│   └── .gitkeep
└── pipeline-status.json # 全体のパイプラインステータス
```

## 成果物の内容

### 1. Collector成果物
**ファイル名**: `collector-YYYY-MM-DD.json`

**内容**:
```json
{
  "timestamp": "2025-11-17T12:00:00.000Z",
  "checkedSources": 10,
  "newCandidates": 5,
  "totalCandidates": 30,
  "metrics": {
    "totalVideosFound": 15,
    "newVideosAdded": 5,
    "duplicatesSkipped": 10
  },
  "errors": [],
  "newVideos": [
    {
      "id": "yt-abc123",
      "videoTitle": "動画タイトル",
      "videoUrl": "https://youtube.com/watch?v=abc123",
      "source": "チャンネル名",
      "publishedAt": "2025-11-17T10:00:00Z"
    }
  ]
}
```

**用途**:
- YouTube動画収集の日次レポート
- 新規動画の監視
- チャンネルごとの活動状況把握

---

### 2. Researcher成果物
**ファイル名**: `researcher-YYYY-MM-DD.json`

**内容**:
```json
{
  "timestamp": "2025-11-17T12:05:00.000Z",
  "processed": 5,
  "succeeded": 5,
  "failed": 0,
  "metrics": {
    "totalProcessed": 5,
    "keywordExtraction": {
      "success": 5,
      "failure": 0,
      "fallbackUsed": 0,
      "successRate": 100
    },
    "googleSearch": {
      "success": 5,
      "failure": 0,
      "totalResults": 15,
      "successRate": 100,
      "avgResultsPerSearch": 3
    },
    "performance": {
      "avgKeywordExtractionTimeMs": 1200,
      "avgGoogleSearchTimeMs": 3500
    }
  },
  "errors": [],
  "researchedCandidates": [
    {
      "id": "yt-abc123",
      "videoTitle": "動画タイトル",
      "searchQuery": {
        "original": "元の動画タイトル",
        "extracted": "抽出されたキーワード",
        "method": "openai"
      },
      "searchSummariesCount": 3,
      "researchedAt": "2025-11-17T12:05:00.000Z"
    }
  ]
}
```

**用途**:
- キーワード抽出の成功率監視
- Google検索の品質確認
- パフォーマンスモニタリング
- エラー率の追跡

---

### 3. Generator成果物 (予約)
将来的に実装予定。記事生成の統計情報などを保存。

---

## データ保持期間

- **日次JSONファイル**: Gitで管理しない（`.gitignore`で除外）
- **ローカル保存のみ**: 必要に応じて手動で確認・分析
- **自動削除**: なし（手動で古いファイルを削除）

## 利用例

### 過去1週間のCollector成果を確認
```bash
ls -lh automation/output/collector/
```

### 特定日のResearcher成果を確認
```bash
cat automation/output/researcher/researcher-2025-11-17.json | jq .
```

### メトリクスの集計
```bash
# 過去7日間のキーワード抽出成功率
jq '.metrics.keywordExtraction.successRate' automation/output/researcher/researcher-*.json
```

## トラブルシューティング

### エラーが多発している場合
1. 該当日のJSONファイルを確認
2. `errors`配列でエラー詳細を確認
3. `metrics`でどのステップで失敗しているか特定

### パフォーマンスが悪化している場合
1. `performance`メトリクスで処理時間を確認
2. API呼び出し回数を確認
3. レート制限に引っかかっていないか確認

## 注意事項

- **個人情報**: 動画タイトルやURLなど公開情報のみ保存
- **API Key**: 絶対に保存しない
- **大容量**: 1ファイル数KB程度、1日2回実行で年間約4MB
