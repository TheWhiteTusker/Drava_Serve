import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule);
app.setGlobalPrefix('api');
app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true });
app.enableShutdownHooks();
await app.listen(Number(process.env.PORT ?? 3000));
console.log(`API listening on ${await app.getUrl()}`);
