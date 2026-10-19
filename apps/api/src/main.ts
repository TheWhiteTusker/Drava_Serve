import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import type { ServerOptions } from 'socket.io';
import { AppModule } from './app.module.js';
import { backupAll } from './data.js';
import { startJobs } from './jobs.js';

// Live updates fan out through Redis so every API instance reaches every device.
class RedisIoAdapter extends IoAdapter {
  private adapter?: ReturnType<typeof createAdapter>;
  async connect(url: string) {
    const pub = createClient({ url });
    const sub = pub.duplicate();
    await Promise.all([pub.connect(), sub.connect()]);
    this.adapter = createAdapter(pub, sub);
  }
  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapter) server.adapter(this.adapter);
    return server;
  }
}

// Not awaited at the top level: on Vercel, listen() is captured and never reports "listening",
// so a top-level await would keep this module from ever finishing loading.
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true });
  app.enableShutdownHooks();
  if (process.env.REDIS_URL) {
    const adapter = new RedisIoAdapter(app);
    await adapter.connect(process.env.REDIS_URL);
    app.useWebSocketAdapter(adapter);
    if (process.env.JOBS !== 'off') await startJobs(process.env.REDIS_URL, { backup: backupAll });
  }
  await app.listen(Number(process.env.PORT ?? 3000));
  console.log(`API listening on ${await app.getUrl()}`);
}
void bootstrap();
