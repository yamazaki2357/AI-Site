# メタタグテンプレート

すべてのHTMLファイルで使用する共通のメタタグ設定です。

## ファビコン設定

```html
<!-- ファビコン -->
<link rel="icon" type="image/svg+xml" href="/assets/img/logo.svg">
<link rel="apple-touch-icon" href="/assets/img/logo.svg">
```

## OGP設定（トップページ用）

```html
<!-- Open Graph / SNS共有 -->
<meta property="og:type" content="website">
<meta property="og:url" content="https://yourdomain.com/">
<meta property="og:title" content="AI情報ブログ - 最新AI情報を自動収集">
<meta property="og:description" content="AI・機械学習の最新情報を自動収集・分析。YouTubeチャンネルから注目トピックを抽出し、深掘りした記事を毎日2回自動更新。">
<meta property="og:image" content="https://yourdomain.com/assets/img/logo.svg">
<meta property="og:site_name" content="AI情報ブログ">
<meta property="og:locale" content="ja_JP">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="AI情報ブログ - 最新AI情報を自動収集">
<meta name="twitter:description" content="AI・機械学習の最新情報を自動収集・分析。YouTubeチャンネルから注目トピックを抽出し、深掘りした記事を毎日2回自動更新。">
<meta name="twitter:image" content="https://yourdomain.com/assets/img/logo.svg">
```

## OGP設定（記事ページ用）

```html
<!-- Open Graph / SNS共有 -->
<meta property="og:type" content="article">
<meta property="og:url" content="https://yourdomain.com/posts/{slug}.html">
<meta property="og:title" content="{記事タイトル} | AI情報ブログ">
<meta property="og:description" content="{記事の要約}">
<meta property="og:image" content="https://yourdomain.com/assets/img/logo.svg">
<meta property="og:site_name" content="AI情報ブログ">
<meta property="og:locale" content="ja_JP">
<meta property="article:published_time" content="{YYYY-MM-DD}T00:00:00+09:00">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{記事タイトル} | AI情報ブログ">
<meta name="twitter:description" content="{記事の要約}">
<meta name="twitter:image" content="https://yourdomain.com/assets/img/logo.svg">
```

## 注意事項

- `og:url`と`og:image`は絶対URLで指定する必要があります
- デプロイ時に実際のドメインに置き換えてください
- OGP画像は推奨サイズ 1200x630px ですが、現在はロゴSVGを使用
