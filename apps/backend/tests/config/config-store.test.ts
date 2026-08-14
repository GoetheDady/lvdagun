import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelConfig } from '@lvdagun/protocol';

import { FileConfigStore } from '../../src/config/config-store';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lvdagun-config-store-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileConfigStore', () => {
  const validConfig: ModelConfig = {
    provider: 'anthropic',
    apiKey: 'sk-test',
    modelId: 'claude-x',
  };

  it('文件不存在时 load 返回 null', async () => {
    const store = new FileConfigStore(join(dir, 'config.json'));
    await expect(store.load()).resolves.toBeNull();
  });

  it('save 后 load 返回相同配置', async () => {
    const store = new FileConfigStore(join(dir, 'config.json'));
    await store.save(validConfig);
    await expect(store.load()).resolves.toEqual(validConfig);
  });

  it('save 自动创建父目录', async () => {
    const store = new FileConfigStore(join(dir, 'sub', 'deep', 'config.json'));
    await store.save(validConfig);
    await expect(store.load()).resolves.toEqual(validConfig);
  });

  it('配置损坏时返回 null 并备份原文件', async () => {
    const file = join(dir, 'config.json');
    await writeFile(file, '{ 这不是合法 JSON', 'utf8');
    const store = new FileConfigStore(file);

    await expect(store.load()).resolves.toBeNull();
    const entries = await readdir(dir);
    expect(entries.some((name) => name.startsWith('config.json.corrupt-'))).toBe(true);
  });

  it('字段类型不符时按损坏配置处理', async () => {
    const file = join(dir, 'config.json');
    await writeFile(file, JSON.stringify({ provider: 42, apiKey: 'x', modelId: 'm' }), 'utf8');
    const store = new FileConfigStore(file);
    await expect(store.load()).resolves.toBeNull();
  });
});
