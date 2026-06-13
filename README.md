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

### プラットフォーム別セットアップ

**Windows(ネイティブ実行)**
- `winget install ffmpeg`(または [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) の static ビルド+環境変数 `FFMPEG_PATH`/`FFPROBE_PATH`)
- whisper.cpp は [リリースの Windows バイナリ](https://github.com/ggml-org/whisper.cpp/releases) を置いて `WHISPER_PATH` で指定

**macOS**
- `brew install ffmpeg whisper-cpp`(whisper-cli が入ります)
- そのほかは共通手順のまま動きます。FCPXML の書き出しも POSIX パス(`/Volumes/...`)で正しく生成されます
- 注意: クリップ ID は素材のパスから決まるため、**同じ素材でも Windows(`E:\...`)と macOS(`/Volumes/...`)ではプロジェクトデータを共有できません**(WSL ⇔ Windows 間は自動で同一 ID になります)

**WSL(開発)**
- home-manager の `home.packages` に `ffmpeg` / `whisper-cpp` を追加済み
- メディアルートに Windows パス(`C:\...`)を入れても `/mnt/c/...` へ自動変換されます

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

構成: pnpm workspace モノレポ

- `packages/shared` — 型定義・API 契約・時間ユーティリティ(server / web の共通言語)
- `packages/server` — Fastify ローカルサーバー(スキャン・ジョブキュー・解析・書き出し・配信・永続化)
- `packages/web` — Vite + React + zustand + leaflet の UI

フロント⇔サーバーは HTTP/JSON のみで疎結合(将来の Tauri 化を考慮)。

## 既知の制約

- 分割ファイルの境界をまたぐ瞬間に一瞬の途切れあり(ソース切替方式)
- シーン解析・全素材プロキシは素材の全デコードを伴うため重い(夜間バッチ推奨)
- FCPXML は DaVinci Resolve の「タイムライン → 読み込み」を想定(パスが変わった場合はメディア再リンクで解決)
