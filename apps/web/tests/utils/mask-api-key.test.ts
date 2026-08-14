import { describe, expect, it } from 'vitest';

import { maskKey } from '@/utils/mask-api-key';

describe('maskKey', () => {
  it('只露前 5 位与后 4 位', () => {
    expect(maskKey('sk-97d14c368c4c446180b0506238af2c84')).toBe('sk-97****2c84');
  });

  it('短 Key 全掩码,空 Key 显示未设置', () => {
    expect(maskKey('abc')).toBe('****');
    expect(maskKey('')).toBe('未设置');
  });
});
