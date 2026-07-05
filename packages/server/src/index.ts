import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { ProjectStore } from './store/projectStore.js';
import { JobQueue } from './jobs/queue.js';
import { JobCoordinator } from './jobs/coordinator.js';
import { TranscriptCache } from './search/transcriptCache.js';
import { registerRoutes } from './routes/api.js';
import { ensureDependencies, makeStdoutEmitter } from './provision/index.js';

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

  const store = ProjectStore.load({
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
  const queue = new JobQueue();
  const coordinator = new JobCoordinator(config, store, queue);
  const transcriptCache = new TranscriptCache(config);
  coordinator.setTranscriptCache(transcriptCache);
  // 起動時にプロキシディレクトリと突き合わせて proxyAvailable を再同期
  coordinator.syncProxyFlags();

  const app = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });
  await app.register(cors, { origin: true });

  registerRoutes(app, { config, store, queue, coordinator, transcriptCache });

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
      await store.flush(); // 保留中の保存を確定
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`project dir: ${config.projectDir}`);

  // Tauri(サイドカー親)へ「listen 開始」を通知する。Rust 側はこの行を受けて
  // WebView を http://localhost:<port> へ遷移させる(splash → 本体)。
  process.stdout.write(`VEH_READY ${config.port}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
