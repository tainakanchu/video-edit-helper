# video-edit-helper

旅行 VLOG など長時間撮りためた動画素材(数十時間級)を俯瞰・メモ・選定して、DaVinci Resolve などの編集ソフトに渡すための映像編集補助ツール。詳細仕様は [SPEC.md](./SPEC.md) を参照。

## 主な機能(Phase 1〜4 実装済み)

**俯瞰とレビュー(Phase 1)**
- 素材スキャン: 日別の自動振り分け、連番分割ファイル(アクションカムの 3〜4GB 分割)の論理クリップ化、カメララベル
- サムネイルストリップ(粗 60 秒 → 密 10 秒の 2 パス生成)+ 発話区間バー(Silero VAD)
- 複数ファイル跨ぎの仮想タイムライン再生、倍速・J/K/L のキーボードファースト操作
- 付箋メモ(タイムコード紐付け・`#タグ`)、視聴済みレンジ自動記録、Day 別の消化率表示

**選定と DaVinci 連携(Phase 2)**
- `I`/`O` キーでイン点/アウト点を打って範囲選定(★評価・タグ・メモ)
- 付箋 → 選定への昇格/破棄、Day 単位の付箋トリアージモード
- ラフカット書き出し: **FCPXML**(DaVinci で「使うところだけ並んだ状態」から編集開始)/ CSV / Markdown
- ブラウザ非対応素材(HEVC / 10-bit)の軽量プロキシ自動生成+プロキシ再生

**文字起こしと検索(Phase 3)**
- whisper.cpp による文字起こし(VAD で発話区間だけ処理して CPU でも現実的に)。日単位の夜間バッチ投入
- メモ・選定・文字起こしの横断検索 →「あの話してたシーン」へ一発ジャンプ

**リッチ化(Phase 4)**
- GPS 付き素材の地図ビュー(Day 色分け・クリップへジャンプ)
- シーン自動分割(場面転換をシークバーに表示、`[` / `]` でジャンプ)
- 全素材プロキシ化オプション(4K 直再生が重い環境向け)

各ページに URL が付いています(`/day/2026-04-19`、`/clip/<id>?t=120`、`/search?q=夕焼け`、`/map` など)。ブラウザの戻る/進む・ブックマーク・リロードがそのまま使えます。

## 必要なもの

| ツール | 用途 |
|---|---|
| Node.js 20+ / pnpm 10 | 実行環境(`corepack enable` 推奨) |
| ffmpeg / ffprobe | メタデータ抽出・サムネイル・プロキシ・音声抽出 |
| whisper-cli(whisper.cpp) | 文字起こし(使う場合のみ) |
| silero_vad.onnx / ggml-*.bin | 解析モデル(下記コマンドで取得) |

### ネイティブ依存(ffmpeg / whisper-cli)の用意

**nix + direnv(推奨。Linux / macOS / WSL 共通)**
- リポジトリに `flake.nix` を同梱しており、devShell に ffmpeg / whisper-cpp をピン留め済み
- [direnv](https://direnv.net/) を使っていれば、プロジェクトに入った時点で自動でツールが PATH に入る:
  ```bash
  direnv allow   # 初回のみ。以後 cd するだけで ffmpeg / whisper-cli が有効
  ```
- direnv 無しでも `nix develop` で同じ環境に入れる
- Node / pnpm は nix ではなく `.tool-versions`([mise](https://mise.jdx.dev/) / asdf)で管理

**nix を使わない場合**
- **macOS**: `brew install ffmpeg whisper-cpp`(whisper-cli が入ります)
- **Windows(ネイティブ実行)**: `winget install ffmpeg`(または [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) の static ビルド)+ [whisper.cpp の Windows バイナリ](https://github.com/ggml-org/whisper.cpp/releases)。パスは `FFMPEG_PATH` / `FFPROBE_PATH` / `WHISPER_PATH` で指定
- いずれも `ffmpeg` / `ffprobe` / `whisper-cli` が PATH にあれば既定設定のまま動きます

### プラットフォーム別の注意

- **macOS**: FCPXML 書き出しは POSIX パス(`/Volumes/...`)で正しく生成されます
- **WSL**: メディアルートに Windows パス(`C:\...`)を入れても `/mnt/c/...` へ自動変換されます
- **クリップ ID は素材のパス由来**: 同じ素材でも Windows(`E:\...`)と macOS(`/Volumes/...`)ではプロジェクトデータを共有できません(WSL ⇔ Windows 間は自動で同一 ID になります)

## セットアップ

```bash
pnpm install
pnpm --filter @veh/server download-model           # Silero VAD モデル(約 2.3MB)
pnpm --filter @veh/server download-whisper-model   # whisper モデル(small, 約 466MB。引数で base/medium 等も可)
```

## 起動

### 通常利用(一発起動)

```bash
pnpm build   # 初回と更新時のみ
pnpm start   # → http://localhost:4810(UI と API を同一ポートで配信)
```

### 開発時(ホットリロード)

```bash
pnpm dev
```

- Web UI: http://localhost:5180(API サーバー :4810 へ自動プロキシ)
- 初回はセットアップ画面でメディアルート(例 `E:\footage`)を登録 →「スキャン開始」
- サムネイル・VAD・プロキシはバックグラウンドジョブで順次生成。シーン解析と文字起こしは重いので各画面のボタンから明示的に投入します(夜寝る前に「この日を文字起こし」がおすすめ)

### 環境変数

| 変数 | デフォルト | 説明 |
|---|---|---|
| `VEH_PROJECT_DIR` | `./project-data` | メモ・キャッシュの保存先(素材ドライブと分離可) |
| `PORT` | `4810` | API サーバーポート |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | バイナリのパス |
| `VEH_VAD_MODEL` | `packages/server/models/silero_vad.onnx` | VAD モデルパス |
| `WHISPER_PATH` | `whisper-cli` | whisper.cpp CLI のパス |
| `VEH_WHISPER_MODEL` | `packages/server/models/ggml-small.bin` | whisper モデルパス |
| `VEH_WHISPER_LANG` | `auto` | 文字起こし言語(誤判定時は `ja` 等で固定) |
| `WHISPER_THREADS` | CPU コア数 − 2 | whisper のスレッド数 |
| `VEH_WEB_DIST` | `packages/web/dist` | 静的配信する Web UI のパス |

### プロジェクトデータの構成

```
project-data/
├── project.json     # メモ・選定・レビュー状態(最重要データ)
├── backups/         # 世代バックアップ(5 分間隔・50 世代)
└── cache/
    ├── thumbs/      # サムネイル
    ├── vad/         # 発話区間
    ├── proxies/     # 軽量プロキシ動画
    ├── scenes/      # シーン転換点
    └── transcripts/ # 文字起こし
```

素材ファイルは**読み取り専用**で扱い、一切書き込みません。

## デスクトップアプリ(Tauri)

ブラウザ + ローカルサーバーの構成をそのまま **Tauri** で 1 つの実行ファイルに包み、配布できます。

### 仕組み

- **サーバーを単一バイナリ化**: `packages/server` を esbuild で 1 ファイルにバンドルし、[`@yao-pkg/pkg`](https://github.com/yao-pkg/pkg) で Node ランタイム同梱の実行ファイルに(`src-tauri/binaries/veh-server-<target>`)。Tauri のサイドカーとして起動します。
- **WebView は `http://localhost:<空きポート>` を開く**: 起動時に空きポートを確保してサーバーへ注入。サーバー(Fastify)が UI と API を同一オリジンで配信するため CORS 不要、Web 版と完全に同じコードが動きます。
- **ffmpeg / ffprobe は初回起動時に自動取得**(crateforge と同じ方式)。取得元は [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) で、**Apple Silicon には arm64 ネイティブ**を取得します(Rosetta 不要)。URL は `VEH_FFMPEG_URL` / `VEH_FFPROBE_URL` で上書き可。`whisper-cli` と Web UI はアプリに同梱。**whisper モデル(約 466MB)も初回起動時にダウンロード**。進捗は起動画面(splash)に表示されます。
- **VAD は silencedetect(ffmpeg)** に固定(onnxruntime-node は単一バイナリに含めないため。Web 版は Silero のまま)。

### 必要なもの

- Rust ツールチェーン(`rustup`)。ネイティブの WebView は OS 標準(macOS は WKWebView)を使うため追加不要
- Node / pnpm(リポジトリ共通)

### 開発・ビルド

```bash
pnpm tauri:dev      # 開発(vite + dev サーバーをそのまま window で表示。サイドカーは使わない)
pnpm tauri:build    # 配布ビルド(.app/.dmg・.msi・.AppImage 等を生成)
```

`tauri:build` は `beforeBuildCommand`(= `pnpm run tauri:prepare`)で **shared/web のビルド → サーバー単一バイナリ生成 → whisper-cli の配置** を自動実行します。CI(`.github/workflows/release.yml`)では macOS(arm64/x64)・Windows・Linux 向けに whisper.cpp を各 OS でビルドして同梱し、タグ push でリリースに添付します。

### データの引き継ぎ(Web 版・既存データから)

パッケージ版はデータの保存先を**起動画面から選べます**(既定は OS のアプリ領域)。

- **既存の `project-data` フォルダを指定すれば、これまでのメモ・選定・キャッシュをそのまま引き継げます**(コピー不要)。
- クリップ ID は素材の絶対パス由来なので、**素材を同じ場所に置いたまま**なら解析キャッシュも含めて完全に再利用されます(別マシンへ移動し素材パスが変わると、手動データは孤児化し再解析になります → 上の「プラットフォーム別の注意」と同じ理由)。

## キーボードショートカット(クリップ画面)

| キー | 動作 |
|---|---|
| `Space` / `K` | 再生 / 一時停止 |
| `J` / `L` | 再生速度を下げる / 上げる(1 / 1.25 / 1.5 / 2 / 3) |
| `←` / `→` | ±10 秒、`Shift` 併用で ±60 秒 |
| `I` / `O` | イン点 / アウト点(O で範囲選定を作成) |
| `[` / `]` | 前 / 次のシーン転換点へ |
| `N` | 現在位置に付箋メモを追加 |
| `R` | レビュー状態を循環(未確認 → 確認中 → 確認済み) |
| `?` | ショートカット一覧、`Esc` | 閉じる / 戻る |

トリアージ画面: `Y` = 昇格 / `X` = 破棄 / `→` = スキップ

## 開発

```bash
pnpm typecheck   # 全パッケージ型チェック
pnpm test        # 全テスト(shared 13 / web 113 / server 191)
pnpm build       # 全ビルド
```

環境は **ネイティブツール(ffmpeg / whisper-cpp)を nix flake、ランタイム(Node / pnpm)を mise** で分担管理しています。

- `flake.nix` / `flake.lock` — ffmpeg・whisper-cpp を nixpkgs の特定リビジョンにピン留め
- `.envrc`(`use flake`)— direnv で devShell を自動ロード
- `.tool-versions` — Node / pnpm のバージョン

構成: pnpm workspace モノレポ

- `packages/shared` — 型定義・API 契約・時間ユーティリティ(server / web の共通言語)
- `packages/server` — Fastify ローカルサーバー(スキャン・ジョブキュー・解析・書き出し・配信・永続化)
- `packages/web` — Vite + React + zustand + leaflet の UI

フロント⇔サーバーは HTTP/JSON のみで疎結合(将来の Tauri 化を考慮)。

## 既知の制約

- 分割ファイルの境界をまたぐ瞬間に一瞬の途切れあり(ソース切替方式)
- シーン解析・全素材プロキシは素材の全デコードを伴うため重い(夜間バッチ推奨)
- FCPXML は DaVinci Resolve の「タイムライン → 読み込み」を想定(パスが変わった場合はメディア再リンクで解決)
