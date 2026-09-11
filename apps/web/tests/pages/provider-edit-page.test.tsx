import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProviderEditPage from '@/pages/provider-edit-page';
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
  providers: [{ provider: 'deepseek', apiKey: 'sk-existing' }],
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

function renderPage(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/model/new" element={<ProviderEditPage />} />
        <Route path="/settings/model/:providerId" element={<ProviderEditPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProviderEditPage', () => {
  it('新建:选 Provider 后可保存,空 Key 存空串', async () => {
    renderPage('/settings/model/new');

    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled();
    // 服务商列表收在浮层里:先展开再选
    await userEvent.click(screen.getByRole('button', { name: '服务商:选择服务商' }));
    await userEvent.click(await screen.findByRole('option', { name: /OpenAI/ }));

    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await vi.waitFor(() => {
      expect(api.saveConfig).toHaveBeenCalledWith({
        providers: [...settings.providers, { provider: 'openai', apiKey: '' }],
        defaultModel: settings.defaultModel,
      });
    });
  });

  it('编辑:Provider 锁定展示,Key 留空沿用已存凭据', async () => {
    renderPage('/settings/model/deepseek');

    await screen.findByText('编辑 DeepSeek');
    // Provider 不出现可编辑控件
    expect(screen.queryByRole('button', { name: /^服务商:/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '保存' }));

    await vi.waitFor(() => {
      expect(api.saveConfig).toHaveBeenCalledWith({
        providers: [{ provider: 'deepseek', apiKey: 'sk-existing' }],
        defaultModel: settings.defaultModel,
      });
    });
  });

  it('编辑:输入新 Key 则覆盖占位符掩码展示的旧 Key', async () => {
    renderPage('/settings/model/deepseek');
    await screen.findByText('编辑 DeepSeek');

    const input = screen.getByLabelText(/API Key/);
    expect(input).toHaveAttribute('placeholder', expect.stringContaining('sk-ex'));
    await userEvent.type(input, 'sk-new');

    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));
    await vi.waitFor(() => {
      expect(api.testConnection).toHaveBeenCalledWith('deepseek', 'sk-new', 'deepseek-v4-flash');
    });

    await userEvent.click(screen.getByRole('button', { name: '保存' }));
    await vi.waitFor(() => {
      expect(api.saveConfig).toHaveBeenCalledWith({
        providers: [{ provider: 'deepseek', apiKey: 'sk-new' }],
        defaultModel: settings.defaultModel,
      });
    });
  });

  it('测试模型列表随 Provider 加载,首个模型默认选中', async () => {
    renderPage('/settings/model/deepseek');

    await userEvent.click(await screen.findByRole('button', { name: /^测试模型:/ }));
    const selected = await screen.findByRole('option', { name: /DeepSeek V4/ });
    expect(selected).toHaveAttribute('data-checked', 'true');
  });

  it('测试通过后在验证分区盖验讫章', async () => {
    vi.mocked(api.testConnection).mockResolvedValue({ ok: true });
    renderPage('/settings/model/deepseek');
    await screen.findByText('编辑 DeepSeek');

    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));

    await screen.findByText('连接成功');
    expect(screen.getByText('验讫')).toBeInTheDocument();
  });

  it('服务商列表支持方向键导航并回车选中', async () => {
    renderPage('/settings/model/new');

    await userEvent.click(screen.getByRole('button', { name: '服务商:选择服务商' }));
    const listbox = await screen.findByRole('listbox', { name: '搜索服务商…' });
    expect(listbox).toBeInTheDocument();
    await userEvent.click(screen.getByPlaceholderText('搜索服务商…'));

    // 原先的列表只有可点行:没有单击语义也没有键盘行为
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /OpenAI/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => {
      expect(api.listModels).toHaveBeenCalledWith('openai');
    });
  });
});
