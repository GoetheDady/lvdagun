import type { ModelSettings } from '@lvdagun/protocol';

/**
 * 校验并规整解析出的模型服务配置 JSON。
 *
 * @param value - JSON.parse 结果
 * @returns 规整后的模型服务配置
 * @throws 字段缺失或类型不符
 */
export function parseModelSettings(value: unknown): ModelSettings {
  if (typeof value !== 'object' || value === null) {
    throw new Error('配置必须是对象');
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.providers)) {
    throw new Error('providers 必须是数组');
  }
  const providers = record.providers.map((item) => {
    if (typeof item !== 'object' || item === null) {
      throw new Error('凭据条目必须是对象');
    }
    const { provider, apiKey } = item as Record<string, unknown>;
    if (typeof provider !== 'string' || provider.trim() === '') {
      throw new Error('provider 必须是非空字符串');
    }
    if (typeof apiKey !== 'string') {
      throw new Error('apiKey 必须是字符串');
    }
    return { provider, apiKey };
  });
  return { providers, defaultModel: parseDefaultModel(record.defaultModel) };
}

/**
 * 校验默认模型引用。
 *
 * @param value - defaultModel 字段原始值
 * @returns 有效的模型引用；字段缺失或为 null 时返回 null
 * @throws 引用结构不完整
 */
function parseDefaultModel(value: unknown): ModelSettings['defaultModel'] {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'object') {
    throw new Error('defaultModel 必须是对象或 null');
  }
  const { provider, id } = value as Record<string, unknown>;
  if (
    typeof provider !== 'string' ||
    provider.trim() === '' ||
    typeof id !== 'string' ||
    id.trim() === ''
  ) {
    throw new Error('defaultModel 必须包含非空 provider 与 id');
  }
  return { provider, id };
}
