# video-edit-helper

旅行 VLOG など長時間撮りためた動画素材(数十時間級)を俯瞰・メモ・選定して、DaVinci Resolve などの編集ソフトに渡すための映像編集補助ツール。詳細仕様は [SPEC.md](./SPEC.md) を参照。

現在 **Phase 1(俯瞰+メモ+持久戦装備)** を実装済み:

- 素材スキャン(日別振り分け・連番分割ファイルの論理クリップ化・カメララベル)
- サムネイルストリップ(粗 60 秒 → 密 10 秒の 2 パス、バックグラウンド生成)
- 発話区間バー(Silero VAD / CPU で高速。silencedetect フォールバック付き)
- プレーヤー(複数ファイル跨ぎ仮想タイムライン・倍速・キーボードファースト)
- 付箋メモ(タイムコード紐付け・#タグ・ステータス)
- レビュー進捗管理(視聴済みレンジ自動記録・クリップ確認ステータス・Day 別消化率)
- JSON 永続化+世代バックアップ

## 必要なもの

| ツール | 用途 |
|---|---|
| Node.js 20+ / pnpm 10 | 実行環境(`corepack enable` 推奨) |
| ffmpeg / ffprobe | メタデータ抽出・サムネイル・音声抽出 |
| silero_vad.onnx | 発話検出モデル(下記コマンドで取得) |

## セットアップ

```bash
pnpm install
pnpm --filter @veh/server download-model   # Silero VAD モデルを取得(約 2.3MB)
```

ffmpeg:

- **Windows(実行環境)**: `winget install ffmpeg` か、[gyan.dev](https://www.gyan.dev/ffmpeg/builds/) の static ビルドを置いて環境変数 `FFMPEG_PATH` / `FFPROBE_PATH` でフルパス指定
- **WSL(開発環境)**: home-manager の `home.packages` に `ffmpeg` を追加済み(`home-manager switch`)

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
- サムネイル・VAD はバックグラウンドジョブで順次生成され、できた分から表示されます

### 環境変数

| 変数 | デフォルト | 説明 |
|---|---|---|
| `VEH_PROJECT_DIR` | `./project-data` | メモ・キャッシュの保存先(素材ドライブと分離可) |
| `PORT` | `4810` | API サーバーポート |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `ffmpeg` / `ffprobe` | バイナリのパス |
| `VEH_VAD_MODEL` | `packages/server/models/silero_vad.onnx` | VAD モデルパス |
| `VEH_WEB_DIST` | `packages/web/dist` | 静的配信する Web UI のパス(無ければ API のみ) |

### プロジェクトデータの構成

```
project-data/
├── project.json     # メモ・選定・レビュー状態(最重要データ)
├── backups/         # 世代バックアップ(5 分間隔・50 世代)
└── cache/
    ├── thumbs/<clipId>/<interval>/<秒>.jpg
    └── vad/<clipId>.json
```

素材ファイルは**読み取り専用**で扱い、一切書き込みません。

## キーボードショートカット(クリップ画面)

| キー | 動作 |
|---|---|
| `Space` / `K` | 再生 / 一時停止 |
| `J` / `L` | 再生速度を下げる / 上げる(1 / 1.25 / 1.5 / 2 / 3) |
| `←` / `→` | ±10 秒 |
| `Shift+←` / `Shift+→` | ±60 秒 |
| `N` | 現在位置に付箋メモを追加 |
| `R` | レビュー状態を循環(未確認 → 確認中 → 確認済み) |
| `?` | ショートカット一覧 |
| `Esc` | 閉じる / Day 一覧へ戻る |

## 開発

```bash
pnpm typecheck   # 全パッケージ型チェック
pnpm test        # 全テスト(shared 13 / web 36 / server 60)
pnpm build       # 全ビルド
```

構成: pnpm workspace モノレポ

- `packages/shared` — 型定義・API 契約・時間ユーティリティ(server / web の共通言語)
- `packages/server` — Fastify ローカルサーバー(スキャン・ジョブキュー・配信・永続化)
- `packages/web` — Vite + React + zustand の UI

フロント⇔サーバーは HTTP/JSON のみで疎結合(将来の Tauri 化を考慮)。

## 既知の制約(Phase 1)

- HEVC / 10-bit 等ブラウザ非対応素材の再生はプレースホルダ表示(サムネ・メモは可)→ Phase 2 でプロキシ生成対応予定
- 分割ファイルの境界をまたぐ瞬間に一瞬の途切れあり(ソース切替方式)
- DaVinci 連携(範囲選定・FCPXML 書き出し)は Phase 2
