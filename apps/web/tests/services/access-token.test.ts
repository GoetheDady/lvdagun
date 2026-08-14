import { beforeEach, describe, expect, it } from 'vitest';

import { getToken, initTokenFromUrl } from '@/services/access-token';

beforeEach(() => {
  localStorage.clear();
});

describe('initTokenFromUrl', () => {
  it('从 URL 读取 token 存入 localStorage，并从地址栏抹掉', () => {
    window.history.replaceState({}, '', '/?token=abc123');
    initTokenFromUrl();
    expect(getToken()).toBe('abc123');
    expect(window.location.search).not.toContain('token');
  });

  it('URL 无 token 时不修改 localStorage', () => {
    window.history.replaceState({}, '', '/');
    initTokenFromUrl();
    expect(getToken()).toBeNull();
  });

  it('URL 无 token 但 localStorage 已有 token 时保留', () => {
    localStorage.setItem('lvdagun-token', 'kept');
    window.history.replaceState({}, '', '/');
    initTokenFromUrl();
    expect(getToken()).toBe('kept');
  });
});
