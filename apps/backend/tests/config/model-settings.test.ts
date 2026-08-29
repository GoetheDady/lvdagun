import { describe, expect, it } from 'vitest';

import { parseModelSettings } from '../../src/config/model-settings';

describe('parseModelSettings', () => {
  it('合法配置原样返回', () => {
    const value = {
      providers: [{ provider: 'openai', apiKey: 'sk-x' }],
      defaultModel: { provider: 'openai', id: 'gpt-x' },
    };
    expect(parseModelSettings(value)).toEqual(value);
  });

  it('空 Provider 列表与 null 默认模型合法', () => {
    expect(parseModelSettings({ providers: [], defaultModel: null })).toEqual({
      providers: [],
      defaultModel: null,
    });
  });

  it('apiKey 允许为空字符串', () => {
    expect(parseModelSettings({ providers: [{ provider: 'ollama', apiKey: '' }], defaultModel: null }).providers[0]?.apiKey).toBe('');
  });

  it('defaultModel 缺失按 null 处理', () => {
    expect(parseModelSettings({ providers: [] }).defaultModel).toBeNull();
  });

  it.each([
    ['providers 缺失', { defaultModel: null }],
    ['providers 非数组', { providers: 'x', defaultModel: null }],
    ['凭据条目不是对象', { providers: ['x'], defaultModel: null }],
    ['凭据 provider 为空', { providers: [{ provider: '  ', apiKey: '' }], defaultModel: null }],
    ['凭据 apiKey 非字符串', { providers: [{ provider: 'p', apiKey: 7 }], defaultModel: null }],
    ['defaultModel 不是对象', { providers: [], defaultModel: 'x' }],
    ['defaultModel 缺 id', { providers: [], defaultModel: { provider: 'p' } }],
    ['不是对象', 'hello'],
  ])('%s 时抛错', (_label, value) => {
    expect(() => parseModelSettings(value)).toThrow();
  });
});
