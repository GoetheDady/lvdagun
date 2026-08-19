import { describe, expect, it } from 'vitest';

import {
  createForkSessionTitle,
  DEFAULT_SESSION_TITLE,
  resolveSessionTitle,
} from '@lvdagun/protocol';

describe('会话标题投影', () => {
  it('依次使用持久化名称、首条用户消息、服务端兜底和默认标题', () => {
    expect(
      resolveSessionTitle({
        sessionName: '  自动或手动标题  ',
        firstUserMessage: '首条消息',
        fallbackTitle: '列表标题',
      })
    ).toBe('自动或手动标题');
    expect(resolveSessionTitle({ sessionName: ' ', firstUserMessage: ' 首条消息 ' })).toBe(
      '首条消息'
    );
    expect(resolveSessionTitle({ fallbackTitle: ' 列表标题 ' })).toBe('列表标题');
    expect(resolveSessionTitle({})).toBe(DEFAULT_SESSION_TITLE);
  });

  it('保留分叉标题后缀', () => {
    expect(createForkSessionTitle('来源标题')).toBe('来源标题（分叉）');
  });
});
