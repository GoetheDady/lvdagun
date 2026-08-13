/**
 * @file Hub 的模型配置能力:Provider/模型列表与测试连接。
 *
 * 列表来源于 Pi SDK 内置目录(无需网络、无需 Key):
 * - Provider 列表:过滤掉基础设施/内部条目(grilling Q14 决策,显示"面向用户的"服务商及其变体)
 * - 模型列表:所选 Provider 的静态目录
 * - 测试连接:该 Provider + Key 发 1 token 最小请求,10 秒超时(grilling Q13 决策)
 */
import type { ModelInfo, ProviderInfo, TestConnectionResult } from '../../shared/ipc';
import { getModelRuntime } from './runtime';

/**
 * 基础设施/内部 Provider:不是给用户填 Key 用的,向导列表排除。
 */
const INFRA_PROVIDERS = new Set([
  'faux',
  'cloudflare-auth',
  'radius-config',
  'radius',
  'amazon-bedrock',
]);

/**
 * 列出向导可选的 Provider(服务商及其变体)。
 *
 * 过滤规则:排除基础设施黑名单,且必须有 API Key 认证方式
 * (oauth-only 的条目用户无法在向导里配置,如 github-copilot)。
 *
 * @returns Provider 列表
 */
export async function listProviders(): Promise<ProviderInfo[]> {
  const runtime = await getModelRuntime();
  return runtime
    .getProviders()
    .filter((provider) => provider.auth.apiKey !== undefined && !INFRA_PROVIDERS.has(provider.id))
    .map((provider) => ({ id: provider.id, name: provider.name }));
}

/**
 * 列出指定 Provider 的模型(静态目录,无需网络)。
 *
 * @param providerId - Provider id
 * @returns 模型列表;Provider 不存在时为空
 */
export async function listModels(providerId: string): Promise<ModelInfo[]> {
  const runtime = await getModelRuntime();
  const provider = runtime.getProviders().find((item) => item.id === providerId);
  if (!provider) {
    return [];
  }
  return provider.getModels().map((model) => ({ id: model.id, name: model.name }));
}

/**
 * 测试连接:用该 Provider + Key 发一次最小模型请求。
 *
 * 选该 Provider 目录里的第一个模型,发 1 token 生成,10 秒超时;
 * 这比查 API 状态更真实(同时验证 Key 与网络链路)。
 *
 * @param provider - Provider id
 * @param apiKey - 待验证的 API Key
 * @returns 测试结果
 */
export async function testConnection(
  provider: string,
  apiKey: string
): Promise<TestConnectionResult> {
  const runtime = await getModelRuntime();
  // setRuntimeApiKey 只写入运行时、不落盘,测试通过后由向导保存配置时才真正持久化
  await runtime.setRuntimeApiKey(provider, apiKey);

  const model = runtime
    .getProviders()
    .find((item) => item.id === provider)
    ?.getModels()[0];
  if (!model) {
    return { ok: false, message: `未找到 provider:${provider}` };
  }

  const stream = runtime.streamSimple(
    model,
    {
      systemPrompt: '连接测试。',
      messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }],
      tools: [],
    },
    { maxTokens: 1, signal: AbortSignal.timeout(10_000) }
  );

  try {
    await stream.result();
    return { ok: true };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'TimeoutError';
    return {
      ok: false,
      message: isTimeout
        ? '连接超时(10 秒)'
        : `连接失败:${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
