import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const settings = {
  providers: [
    { provider: 'deepseek', apiKey: 'sk-97d14c368c4c446180b0506238af2c84' },
    { provider: 'openai', apiKey: '' },
  ],
  defaultModel: { provider: 'deepseek', id: 'deepseek-v4-flash' },
};

beforeEach(() => {
  vi.mocked(api.getConfig).mockResolvedValue(settings);
  vi.mocked(api.saveConfig).mockResolvedValue(undefined);
  vi.mocked(api.listProviders).mockResolvedValue([
    { id: 'deepseek', name: 'DeepSeek' },
    { id: 'openai', name: 'OpenAI' },
  ]);
  vi.mocked(api.listModels).mockResolvedValue([{ id: 'deepseek-v4-flash', name: 'DeepSeek V4' }]);
});

function renderPage(): void {
  render(
    <MemoryRouter initialEntries={['/settings/model']}>
      <Routes>
        <Route path="/settings/model" element={<ModelServicePage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ModelServicePage', () => {
  it('列出已配置 Provider,Key 掩码显示,完整 Key 不出现', async () => {
    renderPage();

    await screen.findByText('DeepSeek');
    expect(screen.getByText('OpenAI')).toBeInTheDocument();
    expect(screen.getByText(`API Key:${'sk-97'}****2c84`)).toBeInTheDocument();
    expect(screen.queryByText(/97d14c368c4c446180b0506238af2c84/)).not.toBeInTheDocument();
  });

  it('删除默认模型所在的 Provider 时,默认模型一并清空', async () => {
    renderPage();
    await screen.findByText('DeepSeek');

    await userEvent.click(screen.getByRole('button', { name: '删除 deepseek' }));
    await screen.findByText(/删除 DeepSeek\?/);
    await userEvent.click(screen.getByRole('button', { name: '删除' }));

    await vi.waitFor(() => {
      expect(api.saveConfig).toHaveBeenCalledWith({
        providers: [{ provider: 'openai', apiKey: '' }],
        defaultModel: null,
      });
    });
  });

  it('删除非默认 Provider 时,默认模型保持不变', async () => {
    renderPage();
    await screen.findByText('DeepSeek');

    await userEvent.click(screen.getByRole('button', { name: '删除 openai' }));
    await screen.findByText(/删除 OpenAI\?/);
    await userEvent.click(screen.getByRole('button', { name: '删除' }));

    await vi.waitFor(() => {
      expect(api.saveConfig).toHaveBeenCalledWith({
        providers: [settings.providers[0]],
        defaultModel: { provider: 'deepseek', id: 'deepseek-v4-flash' },
      });
    });
  });
});
