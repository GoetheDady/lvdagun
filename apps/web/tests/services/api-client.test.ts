import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('@/services/rpc-client', () => ({ getRpcConnection: () => ({ request }) }));

import { api } from '@/services/api-client';

beforeEach(() => request.mockReset());

describe('JSON-RPC 客户端', () => {
  it('通过 RPC 读取配置', async () => {
    request.mockResolvedValue({ provider: 'anthropic', apiKey: 'k', modelId: 'm' });
    await expect(api.getConfig()).resolves.toEqual({
      provider: 'anthropic',
      apiKey: 'k',
      modelId: 'm',
    });
    expect(request).toHaveBeenCalledWith('config/get');
  });

  it('通过 RPC 发送提示并只等待准入响应', async () => {
    request.mockResolvedValue({ accepted: true });
    await api.prompt('session-a', '你好');
    expect(request).toHaveBeenCalledWith('session/prompt', {
      sessionId: 'session-a',
      text: '你好',
    });
  });

  it('把会话操作映射为资源方法和结构化参数', async () => {
    request.mockResolvedValueOnce({ sessionId: 'forked' }).mockResolvedValueOnce({ history: {} });
    await expect(api.forkSession('session/a', 'assistant/1')).resolves.toEqual({
      sessionId: 'forked',
    });
    await api.editAndResend('session/a', 'user/1', '修改后');
    expect(request).toHaveBeenNthCalledWith(1, 'session/fork', {
      sessionId: 'session/a',
      runId: 'assistant/1',
    });
    expect(request).toHaveBeenNthCalledWith(2, 'session/editResend', {
      sessionId: 'session/a',
      itemId: 'user/1',
      text: '修改后',
    });
  });

  it('通过 RPC 管理待处理消息和会话设置', async () => {
    request.mockResolvedValue({});
    await api.steerPendingMessage('session-a', 'pending/a');
    await api.removePendingMessage('session-a', 'pending/a');
    await api.discardPendingMessages('session-a');
    await api.setThinkingLevel('session-a', 'high');
    await api.setSessionModel('session-a', { provider: 'openai', id: 'gpt-a' });
    expect(request).toHaveBeenNthCalledWith(1, 'session/pending/steer', {
      sessionId: 'session-a',
      messageId: 'pending/a',
    });
    expect(request).toHaveBeenNthCalledWith(5, 'session/model', {
      sessionId: 'session-a',
      model: { provider: 'openai', id: 'gpt-a' },
    });
  });
});
