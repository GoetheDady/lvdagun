import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileConfigStore } from '../../../src/config/config-store';
import { makeFakeHub, startServer, TOKEN } from '../test-server';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lvdagun-catalog-routes-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('模型目录接口', () => {
  it('Provider、模型与连接测试透传到 Agent Hub', async () => {
    const { hub } = makeFakeHub();
    const { baseUrl, close } = await startServer(
      hub,
      new FileConfigStore(join(dir, 'config.json'))
    );
    try {
      const providers = await fetch(`${baseUrl}/api/providers`, {
        headers: { 'x-lvdagun-token': TOKEN },
      });
      await expect(providers.json()).resolves.toEqual([{ id: 'anthropic', name: 'Anthropic' }]);

      const models = await fetch(`${baseUrl}/api/models?provider=anthropic`, {
        headers: { 'x-lvdagun-token': TOKEN },
      });
      await expect(models.json()).resolves.toEqual([{ id: 'claude-a', name: 'Claude A' }]);

      const test = await fetch(`${baseUrl}/api/test-connection`, {
        method: 'POST',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ provider: 'anthropic', apiKey: 'good' }),
      });
      await expect(test.json()).resolves.toEqual({ ok: true });
    } finally {
      await close();
    }
  });
});
