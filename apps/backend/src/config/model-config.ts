import type { ModelConfig } from '@lvdagun/protocol';

/**
 * 校验并规整解析出的 JSON。
 *
 * @param value - JSON.parse 结果
 * @returns 规整后的模型配置
 * @throws 字段缺失或类型不符
 */
export function parseModelConfig(value: unknown): ModelConfig {
  if (typeof value !== 'object' || value === null) {
    throw new Error('配置必须是对象');
  }
  const record = value as Record<string, unknown>;
  const { provider, modelId, apiKey } = record;
  if (typeof provider !== 'string' || provider.trim() === '') {
    throw new Error('provider 必须是非空字符串');
  }
  if (typeof modelId !== 'string' || modelId.trim() === '') {
    throw new Error('modelId 必须是非空字符串');
  }
  if (typeof apiKey !== 'string') {
    throw new Error('apiKey 必须是字符串');
  }
  return { provider, modelId, apiKey };
}
