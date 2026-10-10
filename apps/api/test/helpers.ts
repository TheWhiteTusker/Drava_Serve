import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { provisionCustomer } from '../src/bootstrap.js';
import { dropCustomer, migrateControl } from '../src/db/index.js';

export async function startApp() {
  await migrateControl();
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}

// A throwaway customer with its own database; dropped by the returned cleanup.
export async function tempCustomer(prefix: string) {
  const code = `t_${prefix}_${Math.random().toString(36).slice(2, 8)}`;
  const login = `owner@${code}.test`;
  const customer = await provisionCustomer({ code, name: `Test ${code}`, owner: { login, name: 'Test owner', password: 'Passw0rd!' } });
  return { code, login, password: 'Passw0rd!', customer, drop: () => dropCustomer(code) };
}

export function client(app: INestApplication, token?: string, device = 'test-device') {
  const auth = (r: request.Test) => (token ? r.set('authorization', `Bearer ${token}`) : r).set('x-device-id', device);
  const http = request(app.getHttpServer());
  return {
    get: (p: string) => auth(http.get(`/api${p}`)),
    post: (p: string, body?: object) => (body === undefined ? auth(http.post(`/api${p}`)) : auth(http.post(`/api${p}`)).send(body)),
    put: (p: string, body?: object) => auth(http.put(`/api${p}`)).send(body ?? {}),
  };
}

export async function signIn(app: INestApplication, login: string, password: string) {
  const r = await client(app).post('/auth/login', { login, password });
  if (r.status !== 201) throw new Error(`sign-in failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.token as string;
}
