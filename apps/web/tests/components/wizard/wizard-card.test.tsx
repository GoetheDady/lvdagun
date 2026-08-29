import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WizardCard } from '@/components/wizard/wizard-card';
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

const providers = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'openai', name: 'OpenAI' },
];
const models = [
  { id: 'claude-a', name: 'Claude A' },
  { id: 'claude-b', name: 'Claude B' },
];

beforeEach(() => {
  vi.mocked(api.listProviders).mockResolvedValue(providers);
  vi.mocked(api.listModels).mockResolvedValue(models);
  vi.mocked(api.testConnection).mockResolvedValue({ ok: true });
  vi.mocked(api.saveConfig).mockResolvedValue(undefined);
});

/** 走完前两步:选 Anthropic、选 Claude A,进入 API Key 步骤 */
async function gotoApiKeyStep(): Promise<void> {
  await screen.findByText('Anthropic');
  await userEvent.click(screen.getByText('Anthropic'));
  await userEvent.click(screen.getByRole('button', { name: '下一步' }));
  await screen.findByText('Claude A');
  await userEvent.click(screen.getByText('Claude A'));
  await userEvent.click(screen.getByRole('button', { name: '下一步' }));
  await screen.findByLabelText(/API Key/);
}

describe('WizardCard', () => {
  it('第一步:列出 Provider,选中后才能进入下一步', async () => {
    render(<WizardCard onDone={vi.fn()} />);

    await screen.findByText('Anthropic');
    await screen.findByText('OpenAI');
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();

    await userEvent.click(screen.getByText('Anthropic'));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByText('Claude A');
  });

  it('第二步:列出模型,选中后才能进入下一步', async () => {
    render(<WizardCard onDone={vi.fn()} />);
    await screen.findByText('Anthropic');
    await userEvent.click(screen.getByText('Anthropic'));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));

    await screen.findByText('Claude B');
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();

    await userEvent.click(screen.getByText('Claude B'));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByLabelText(/API Key/);
  });

  it('第三步:测试连接成功后才能完成', async () => {
    render(<WizardCard onDone={vi.fn()} />);
    await gotoApiKeyStep();

    const input = screen.getByLabelText(/API Key/);
    expect(screen.getByRole('button', { name: '完成' })).toBeDisabled();

    await userEvent.type(input, 'sk-123');
    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));

    await screen.findByText('连接成功');
    expect(screen.getByRole('button', { name: '完成' })).toBeEnabled();
  });

  it('第三步:测试连接失败显示错误信息,不能完成', async () => {
    vi.mocked(api.testConnection).mockResolvedValue({ ok: false, message: '401 凭证无效' });
    render(<WizardCard onDone={vi.fn()} />);
    await gotoApiKeyStep();

    await userEvent.type(screen.getByLabelText(/API Key/), 'sk-bad');
    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));

    await screen.findByText('401 凭证无效');
    expect(screen.getByRole('button', { name: '完成' })).toBeDisabled();
  });

  it('第三步:Key 修改后旧测试结果作废', async () => {
    render(<WizardCard onDone={vi.fn()} />);
    await gotoApiKeyStep();

    const input = screen.getByLabelText(/API Key/);
    await userEvent.type(input, 'sk-123');
    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));
    await screen.findByText('连接成功');

    await userEvent.clear(input);
    await userEvent.type(input, 'sk-changed');

    expect(screen.queryByText('连接成功')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完成' })).toBeDisabled();
  });

  it('走完全程:以选定配置保存并回调 onDone', async () => {
    const onDone = vi.fn();
    render(<WizardCard onDone={onDone} />);
    await gotoApiKeyStep();

    await userEvent.type(screen.getByLabelText(/API Key/), 'sk-123');
    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));
    await screen.findByText('连接成功');
    await userEvent.click(screen.getByRole('button', { name: '完成' }));

    await waitFor(() => {
      expect(api.testConnection).toHaveBeenCalledWith('anthropic', 'sk-123', 'claude-a');
      expect(api.saveConfig).toHaveBeenCalledWith({
        providers: [{ provider: 'anthropic', apiKey: 'sk-123' }],
        defaultModel: { provider: 'anthropic', id: 'claude-a' },
      });
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('回上一步再前进,已填内容保留', async () => {
    render(<WizardCard onDone={vi.fn()} />);
    await gotoApiKeyStep();

    const input = screen.getByLabelText(/API Key/);
    await userEvent.type(input, 'sk-keep');
    await userEvent.click(screen.getByRole('button', { name: '上一步' }));
    await screen.findByText('Claude A');

    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    expect(screen.getByLabelText(/API Key/)).toHaveValue('sk-keep');
  });

  it('测试通过后换服务商:Key、模型与旧测试结果全部作废', async () => {
    render(<WizardCard onDone={vi.fn()} />);
    await gotoApiKeyStep();

    await userEvent.type(screen.getByLabelText(/API Key/), 'sk-old');
    await userEvent.click(screen.getByRole('button', { name: '测试连接' }));
    await screen.findByText('连接成功');

    // 回第一步换 OpenAI,再前进:旧 Key 已清空、模型选择已复位
    await userEvent.click(screen.getByRole('button', { name: '上一步' }));
    await userEvent.click(screen.getByRole('button', { name: '上一步' }));
    await screen.findByText('OpenAI');
    await userEvent.click(screen.getByText('OpenAI'));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));

    await screen.findByText('Claude A');
    expect(screen.getByRole('button', { name: '下一步' })).toBeDisabled();

    await userEvent.click(screen.getByText('Claude A'));
    await userEvent.click(screen.getByRole('button', { name: '下一步' }));
    await screen.findByLabelText(/API Key/);
    expect(screen.getByLabelText(/API Key/)).toHaveValue('');
    expect(screen.queryByText('连接成功')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '完成' })).toBeDisabled();
  });
});
