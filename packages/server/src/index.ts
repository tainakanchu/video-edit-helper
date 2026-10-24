import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { ProjectStore, ProjectUnreadableError } from './store/projectStore.js';
import { JobQueue } from './jobs/queue.js';
import { JobCoordinator } from './jobs/coordinator.js';
import { TranscriptCache } from './search/transcriptCache.js';
import { registerRoutes } from './routes/api.js';
import { ensureDependencies, makeStdoutEmitter } from './provision/index.js';
import { MountStore } from './media/mounts.js';
import { generateToken, registerSecurity, writeTokenFile } from './security.js';
import { TOKEN_FRAGMENT_KEY } from '@veh/shared';

async function main(): Promise<void> {
  const config = loadConfig();

  // パッケージ版(VEH_AUTO_PROVISION=1)は listen 前に依存(ffmpeg/モデル)を用意する。
  // 進捗は stdout の NDJSON で Tauri 側 splash に転送される。dev では即 return。
  const emit = makeStdoutEmitter();
  try {
    await ensureDependencies(config, emit);
  } catch (e) {
    emit({ phase: 'ready', status: 'error', message: (e as Error).message });
    console.error('[provision] 依存の準備に失敗しました:', e);
    process.exit(1);
  }

  let store: ProjectStore;
  try {
    store = ProjectStore.load({
      projectFile: config.projectFile,
      backupsDir: config.backupsDir,
      // v1→v2 移行時にサムネ/VAD/文字起こし/シーン/プロキシのキャッシュも rename する
      cacheDirs: {
        thumbsDir: config.thumbsDir,
        vadDir: config.vadDir,
        transcriptsDir: config.transcriptsDir,
        scenesDir: config.scenesDir,
        proxiesDir: config.proxiesDir,
      },
    });
  } catch (e) {
    if (e instanceof ProjectUnreadableError) {
      // 保存先が読めない(OneDrive 等でローカル未取得/破損)。
      // ここで空データを保存すると本物を壊すので、書き込みは一切せず、
      // プロセスも殺さない。スプラッシュに保存先エラーを出し、ユーザーが
      // 「フォルダを変更/既定に戻す」で保存先を直して再起動できるよう待機する。
      emit({
        phase: 'data',
        status: 'error',
        message:
          'データ保存先の project.json を読み込めませんでした。' +
          'OneDrive 等のクラウド上のみでローカルに未取得の可能性があります。' +
          'OneDrive を起動して同期を完了するか、下の「フォルダを変更／既定に戻す」で保存先を変えてください。' +
          '(データは失われていません)',
      });
      console.error('[data] プロジェクト読み込み失敗(スプラッシュで保存先変更待ち):', e);
      // プロセスを生かし続ける。ここで終了すると Rust 側が「サーバープロセスが
      // 終了しました」を出して上の 'data' エラー表示を上書きしてしまう。
      // 未解決 Promise だけではイベントループが空になり Node が終了するため、
      // キープアライブのタイマーを置く(保存先変更→再起動で解放される)。
      setInterval(() => {}, 1 << 30);
      await new Promise<never>(() => {
        /* 保存先変更→再起動で復帰。ここでプロセスを維持しアプリを落とさない */
      });
    }
    throw e;
  }
  const queue = new JobQueue();
  const mounts = new MountStore(config.mountsFile);
  const coordinator = new JobCoordinator(config, store, queue, mounts);
  const transcriptCache = new TranscriptCache(config);
  coordinator.setTranscriptCache(transcriptCache);
  // 起動時にプロキシディレクトリと突き合わせて proxyAvailable を再同期
  coordinator.syncProxyFlags();

  const app = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });
  // Host / Origin / 起動ごとのトークンを検証する(CORS もここで自分の Origin だけに絞る)
  const token = generateToken();
  await registerSecurity(app, {
    token,
    port: config.port,
    extraHosts: config.extraAllowedHosts,
    extraOrigins: config.extraAllowedOrigins,
  });

  registerRoutes(app, { config, store, queue, coordinator, transcriptCache, mounts });

  // ビルド済み Web UI があれば同一ポートで静的配信(pnpm start 一発で全部起動)
  if (fs.existsSync(path.join(config.webDistDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: config.webDistDir });
    // SPA フォールバック: /api 以外の未知パスは index.html を返す
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        void reply.code(404).send({ error: 'not found' });
        return;
      }
      void reply.sendFile('index.html');
    });
    app.log.info(`serving web ui from ${config.webDistDir}`);
  } else {
    app.log.info('web ui not built (packages/web/dist not found) — api only');
  }

  const shutdown = async (): Promise<void> => {
    try {
      if (config.devTokenFile) fs.rmSync(config.devTokenFile, { force: true });
      await store.flush(); // 保留中の保存を確定
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await app.listen({ port: config.port, host: config.host });
  app.log.info(`project dir: ${config.projectDir}`);
  if (config.host !== '127.0.0.1' && config.host !== 'localhost' && config.host !== '::1') {
    app.log.warn(
      `${config.host} で listen しています(LAN に公開)。Host ヘッダは VEH_ALLOWED_HOSTS に足したものだけ通します`,
    );
  }

  if (config.devTokenFile) {
    // dev: vite の proxy がこのファイルを読んで X-VEH-Token を付ける
    writeTokenFile(config.devTokenFile, token);
  }
  if (!config.autoProvision) {
    // pnpm start 等でブラウザから直接開く場合の入口(フラグメントはサーバーへ送られない)
    console.log(
      `[veh] UI: http://localhost:${config.port}/#${TOKEN_FRAGMENT_KEY}=${token}` +
        `  (dev の vite 経由なら http://localhost:5180/ をそのまま開けばよい)`,
    );
  }

  // Tauri(サイドカー親)へ「listen 開始」とトークンを通知する。Rust 側はこの行を受けて
  // WebView を http://localhost:<port>/#veh-token=<token> へ遷移させる(splash → 本体)。
  // stdout は Tauri とのパイプなので外へは出ない。
  process.stdout.write(`VEH_READY ${config.port} ${token}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
