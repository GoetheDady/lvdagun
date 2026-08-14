import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, it, vi } from 'vitest';

import { api } from '@/lib/api';
import App from './App';

vi.mock('@/lib/api', () => ({
  api: {
    getConfig: vi.fn(),
    saveConfig: vi.fn(),
    testConnection: vi.fn(),
    listProviders: vi.fn(),
    listModels: vi.fn(),
    getMessages: vi.fn(),
    prompt: vi.fn(),
    clearSession: vi.fn(),
  },
  initTokenFromUrl: vi.fn(),
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
  vi.mocked(api.getMessages).mockResolvedValue([]);
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
    vi.mocked(api.getConfig).mockResolvedValue({ provider: 'anthropic', apiKey: 'k', modelId: 'm' });
    renderApp('/');
    await screen.findByPlaceholderText(/输入消息/);
  });

  it('直接访问 /settings 进入设置页', async () => {
    renderApp('/settings');
    await screen.findByRole('heading', { name: '设置' });
  });
});
