import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, it, vi } from 'vitest';

import App from '@/app';
import { api } from '@/services/api-client';

vi.mock('@/services/api-client', () => ({
  api: {
    getConfig: vi.fn(),
    saveConfig: vi.fn(),
    testConnection: vi.fn(),
    listProviders: vi.fn(),
    listModels: vi.fn(),
    listSessions: vi.fn(),
    createSession: vi.fn(),
    archiveSession: vi.fn(),
    deleteSession: vi.fn(),
    setSessionTitle: vi.fn(),
    getMessages: vi.fn(),
    getSessionState: vi.fn(),
    prompt: vi.fn(),
    abortSession: vi.fn(),
    setThinkingLevel: vi.fn(),
    setSessionModel: vi.fn(),
  },
}));

vi.mock('@/services/session-events', () => ({
  subscribeEvents: vi.fn(() => () => {}),
}));

function renderApp(initialPath = '/'): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <App />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.mocked(api.listSessions).mockResolvedValue([
    {
      id: 'session-a',
      title: '新对话',
      createdAt: 1,
      updatedAt: 1,
      messageCount: 0,
      isRunning: false,
    },
  ]);
  vi.mocked(api.createSession).mockResolvedValue({ sessionId: 'session-a' });
  vi.mocked(api.getMessages).mockResolvedValue({
    schemaVersion: 1,
    sessionId: 'session-a',
    branchId: 'branch-a',
    revision: 0,
    runs: [],
    draft: null,
    blobs: {},
  });
  vi.mocked(api.getSessionState).mockResolvedValue({
    sessionName: null,
    executionAvailable: true,
    isRunning: false,
    activeCompaction: null,
    pendingMessages: [],
    thinkingLevel: 'medium',
    availableThinkingLevels: ['off', 'low', 'medium', 'high'],
    model: {
      provider: 'anthropic',
      providerName: 'Anthropic',
      id: 'claude-a',
      name: 'Claude A',
    },
    availableModels: [
      {
        provider: 'anthropic',
        providerName: 'Anthropic',
        id: 'claude-a',
        name: 'Claude A',
      },
    ],
    modelWarning: null,
  });
  vi.mocked(api.listProviders).mockResolvedValue([]);
});

describe('App 路由与守卫', () => {
  it('未配置时首页重定向到配置向导', async () => {
    vi.mocked(api.getConfig).mockResolvedValue(null);
    renderApp('/');
    // 向导第一步:出现"选择模型服务商"步骤标题
    await screen.findByText('选择模型服务商', { exact: false });
  });

  it('已配置时首页直接进入对话页', async () => {
    vi.mocked(api.getConfig).mockResolvedValue({
      provider: 'anthropic',
      apiKey: 'k',
      modelId: 'm',
    });
    renderApp('/');
    await screen.findByPlaceholderText(/输入消息/);
  });

  it('直接访问 /settings 进入设置页', async () => {
    renderApp('/settings');
    await screen.findByRole('heading', { name: '设置' });
  });
});
