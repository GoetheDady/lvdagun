import { render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SettingsPage, { AboutPanel } from '@/pages/settings-page';
import ModelServicePage from '@/pages/model-service-page';
import { api } from '@/services/api-client';

vi.mock('@/services/api-client', () => ({
  api: {
    getConfig: vi.fn(),
    saveConfig: vi.fn(),
    testConnection: vi.fn(),
    listProviders: vi.fn(),
    listModels: vi.fn(),
  },
}));

beforeEach(() => {
  vi.mocked(api.getConfig).mockResolvedValue({
    providers: [{ provider: 'deepseek', apiKey: 'sk-97d14c368c4c446180b0506238af2c84' }],
    defaultModel: { provider: 'deepseek', id: 'deepseek-v4-flash' },
  });
  vi.mocked(api.listProviders).mockResolvedValue([{ id: 'deepseek', name: 'DeepSeek' }]);
  vi.mocked(api.listModels).mockResolvedValue([{ id: 'deepseek-v4-flash', name: 'DeepSeek V4' }]);
});

function renderSettings(path = '/settings'): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />}>
          <Route index element={<Navigate to="model" replace />} />
          <Route path="model" element={<ModelServicePage />} />
          <Route path="about" element={<AboutPanel />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('SettingsPage 布局', () => {
  it('左侧是分区导航,右侧默认落在模型服务', async () => {
    renderSettings('/settings/model');

    expect(screen.getByRole('heading', { name: '设置' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /模型服务/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /关于/ })).toBeInTheDocument();
    await screen.findByText('默认模型');
  });

  it('关于分区展示产品信息与隐私说明', async () => {
    renderSettings('/settings/about');

    await screen.findByText('驴打滚');
    expect(screen.getByText('V0 · 个人 AI 管家')).toBeInTheDocument();
    expect(screen.getByText(/对话数据只存本机/)).toBeInTheDocument();
  });
});
