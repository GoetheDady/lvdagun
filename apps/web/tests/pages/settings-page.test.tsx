import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SettingsPage from '@/pages/settings-page';
import { api } from '@/services/api-client';

vi.mock('@/services/api-client', () => ({
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
}));

beforeEach(() => {
  vi.mocked(api.listProviders).mockResolvedValue([]);
  vi.mocked(api.listModels).mockResolvedValue([]);
});

describe('SettingsPage', () => {
  it('展示当前配置,API Key 掩码显示', async () => {
    vi.mocked(api.getConfig).mockResolvedValue({
      provider: 'deepseek',
      apiKey: 'sk-97d14c368c4c446180b0506238af2c84',
      modelId: 'deepseek-v4-flash',
    });
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );

    await screen.findByText('Provider:deepseek');
    expect(screen.getByText('Model:deepseek-v4-flash')).toBeInTheDocument();
    expect(screen.getByText('API Key:sk-97****2c84')).toBeInTheDocument();
    // 完整 Key 不出现在页面上
    expect(screen.queryByText(/sk-97d14c368c4c446180b0506238af2c84/)).not.toBeInTheDocument();
  });

  it('未配置时显示占位', async () => {
    vi.mocked(api.getConfig).mockResolvedValue(null);
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    );
    await screen.findByText('尚未配置');
  });
});
