import { describe, expect, it } from 'vitest';

import { parseModelConfig } from '../../src/config/model-config';

describe('parseModelConfig', () => {
  it('合法配置原样返回', () => {
    expect(parseModelConfig({ provider: 'openai', apiKey: '', modelId: 'gpt-x' })).toEqual({
      provider: 'openai',
      apiKey: '',
      modelId: 'gpt-x',
    });
  });

  it('apiKey 允许为空字符串', () => {
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
