import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileConfigStore, getOrCreateToken, parseModelConfig } from '../src/config';
import type { ModelConfig } from '../src/protocol';

/** 每个用例独立的临时数据目录,绝不触碰真实 ~/.lvdagun */
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lvdagun-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('FileConfigStore', () => {
  const validConfig: ModelConfig = { provider: 'anthropic', apiKey: 'sk-test', modelId: 'claude-x' };

  it('文件不存在时 load 返回 null(未配置)', async () => {
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

  it('配置损坏时 load 返回 null 并把原文件备份为 .corrupt-*', async () => {
    const file = join(dir, 'config.json');
    await writeFile(file, '{ 这不是合法 JSON', 'utf8');
    const store = new FileConfigStore(file);

    await expect(store.load()).resolves.toBeNull();

    const entries = await readdir(dir);
    expect(entries.some((name) => name.startsWith('config.json.corrupt-'))).toBe(true);
  });

  it('字段类型不符按损坏处理(provider 非字符串)', async () => {
    const file = join(dir, 'config.json');
    await writeFile(file, JSON.stringify({ provider: 42, apiKey: 'x', modelId: 'm' }), 'utf8');
    const store = new FileConfigStore(file);
    await expect(store.load()).resolves.toBeNull();
  });
});

describe('parseModelConfig', () => {
  it('合法配置原样返回', () => {
    expect(parseModelConfig({ provider: 'openai', apiKey: '', modelId: 'gpt-x' })).toEqual({
      provider: 'openai',
      apiKey: '',
      modelId: 'gpt-x',
    });
  });

  it('apiKey 允许为空字符串(Ollama 等本地 Provider)', () => {
    expect(parseModelConfig({ provider: 'ollama', apiKey: '', modelId: 'llama3' }).apiKey).toBe('');
  });

  it.each([
    ['provider 为空', { provider: '  ', apiKey: 'x', modelId: 'm' }],
    ['modelId 缺失', { provider: 'p', apiKey: 'x' }],
    ['apiKey 非字符串', { provider: 'p', apiKey: 7, modelId: 'm' }],
    ['不是对象', 'hello'],
  ])('%s 时抛错', (_label, value) => {
    expect(() => parseModelConfig(value)).toThrow();
  });
});

describe('getOrCreateToken', () => {
  it('首次调用生成随机 token 并落盘,再次调用返回同一个 token', async () => {
    const first = await getOrCreateToken(dir);
    expect(first).toMatch(/^[0-9a-f]{64}$/);

    const second = await getOrCreateToken(dir);
    expect(second).toBe(first);

    // 落盘的 token 与返回值一致
    const fileContent = await readFile(join(dir, 'token'), 'utf8');
    expect(fileContent.trim()).toBe(first);
  });
});
