import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { ProjectStore } from './store/projectStore.js';
import { JobQueue } from './jobs/queue.js';
import { JobCoordinator } from './jobs/coordinator.js';
import { registerRoutes } from './routes/api.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const store = ProjectStore.load({
    projectFile: config.projectFile,
    backupsDir: config.backupsDir,
  });
  const queue = new JobQueue();
  const coordinator = new JobCoordinator(config, store, queue);

  const app = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });
  await app.register(cors, { origin: true });

  registerRoutes(app, { config, store, queue, coordinator });

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
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
