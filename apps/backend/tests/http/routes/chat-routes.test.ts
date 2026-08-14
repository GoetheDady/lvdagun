import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileConfigStore } from '../../../src/config/config-store';
import { makeFakeHub, startServer, TOKEN } from '../test-server';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lvdagun-chat-routes-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('对话接口', () => {
  it('未配置时发送消息返回 409', async () => {
    const { hub } = makeFakeHub();
    const { baseUrl, close } = await startServer(
      hub,
      new FileConfigStore(join(dir, 'config.json'))
    );
    try {
      const response = await fetch(`${baseUrl}/api/prompt`, {
        method: 'POST',
        headers: { 'x-lvdagun-token': TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ text: '你好' }),
      });
      expect(response.status).toBe(409);
    } finally {
      await close();
    }
  });
});
