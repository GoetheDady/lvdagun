import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileConfigStore } from '../../../src/config/config-store';
import { makeFakeHub, startServer } from '../test-server';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lvdagun-auth-http-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('token 鉴权', () => {
  it('无 token 的请求返回 401', async () => {
    const { hub } = makeFakeHub();
    const { baseUrl, close } = await startServer(
      hub,
      new FileConfigStore(join(dir, 'config.json'))
    );
    try {
      const response = await fetch(`${baseUrl}/api/config`);
      expect(response.status).toBe(401);
    } finally {
      await close();
    }
  });

  it('错误 token 的请求返回 401', async () => {
    const { hub } = makeFakeHub();
    const { baseUrl, close } = await startServer(
      hub,
      new FileConfigStore(join(dir, 'config.json'))
    );
    try {
      const response = await fetch(`${baseUrl}/api/config`, {
        headers: { 'x-lvdagun-token': 'wrong' },
      });
      expect(response.status).toBe(401);
    } finally {
      await close();
    }
  });
});
