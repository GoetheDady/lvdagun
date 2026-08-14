import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getOrCreateToken } from '../../src/auth/access-token';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lvdagun-token-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('getOrCreateToken', () => {
  it('首次调用生成 token 并落盘，再次调用返回同一个 token', async () => {
    const first = await getOrCreateToken(dir);
    expect(first).toMatch(/^[0-9a-f]{64}$/);

    const second = await getOrCreateToken(dir);
    expect(second).toBe(first);

    const fileContent = await readFile(join(dir, 'token'), 'utf8');
    expect(fileContent.trim()).toBe(first);
  });
});
