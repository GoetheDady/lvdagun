import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelConfig } from '@lvdagun/protocol';

import { FileConfigStore } from '../../../src/config/config-store';
import { makeFakeHub, startServer, validConfig } from '../test-server';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lvdagun-config-routes-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('配置接口', () => {
  it('GET 未配置时返回 null', async () => {
    const { hub } = makeFakeHub();
    const { baseUrl, close } = await startServer(
      hub,
      new FileConfigStore(join(dir, 'config.json'))
    );
    try {
      const response = await fetch(`${baseUrl}/api/config`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toBeNull();
    } finally {
      await close();
    }
  });

  it('PUT 后 GET 返回相同配置并持久化到磁盘', async () => {
    const { hub } = makeFakeHub();
    const file = join(dir, 'config.json');
    const { baseUrl, close } = await startServer(hub, new FileConfigStore(file));
    try {
      const put = await fetch(`${baseUrl}/api/config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validConfig),
      });
      expect(put.status).toBe(204);

      const get = await fetch(`${baseUrl}/api/config`);
      await expect(get.json()).resolves.toEqual(validConfig);
      expect(JSON.parse(await readFile(file, 'utf8')) as ModelConfig).toEqual(validConfig);
    } finally {
      await close();
    }
  });

  it('PUT 非法配置返回 400', async () => {
    const { hub } = makeFakeHub();
    const { baseUrl, close } = await startServer(
      hub,
      new FileConfigStore(join(dir, 'config.json'))
    );
    try {
      const response = await fetch(`${baseUrl}/api/config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: '', apiKey: 'x', modelId: 'm' }),
      });
      expect(response.status).toBe(400);
    } finally {
      await close();
    }
  });

  it('配置变更后释放旧会话，下次对话按新配置重建', async () => {
    const { hub, sessions } = makeFakeHub();
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    const { baseUrl, close } = await startServer(hub, store);
    try {
      await fetch(`${baseUrl}/api/sessions/session-1/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '你好' }),
      });

      const newConfig: ModelConfig = {
        provider: 'openai',
        apiKey: 'sk-new',
        modelId: 'gpt-x',
      };
      const put = await fetch(`${baseUrl}/api/config`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(newConfig),
      });
      expect(put.status).toBe(204);
      expect(sessions[0]!.disposeCalls).toBe(1);

      await fetch(`${baseUrl}/api/sessions/session-1/prompt`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '还在吗' }),
      });
      expect(sessions).toHaveLength(2);
      expect(hub.openSession).toHaveBeenLastCalledWith(newConfig, 'session-1');
    } finally {
      await close();
    }
  });
});
