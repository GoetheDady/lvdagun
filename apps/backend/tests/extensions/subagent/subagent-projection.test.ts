import { describe, expect, it } from 'vitest';

import { parseSubagentDelegations } from '@lvdagun/protocol';

const validDelegation = {
  id: 'child-1',
  agent: 'scout',
  task: '调查',
  status: 'success',
  childSessionId: 'child-1',
  result: '结论',
  usage: { turns: 1, inputTokens: 10, outputTokens: 5, cost: 0.01 },
  error: null,
  steps: 2,
  activity: null,
  startedAt: 1,
  endedAt: 2,
};

describe('parseSubagentDelegations', () => {
  it('解析合法的委派投影', () => {
    const parsed = parseSubagentDelegations({ delegations: [validDelegation] });
    expect(parsed).toEqual([validDelegation]);
  });

  it('details 缺失或形状不符时返回 null', () => {
    expect(parseSubagentDelegations(undefined)).toBeNull();
    expect(parseSubagentDelegations({})).toBeNull();
    expect(parseSubagentDelegations({ delegations: [{ agent: 'scout' }] })).toBeNull();
  });

  it('拒绝非法的 agent 名称与状态', () => {
    expect(
      parseSubagentDelegations({ delegations: [{ ...validDelegation, agent: 'hacker' }] })
    ).toBeNull();
    expect(
      parseSubagentDelegations({ delegations: [{ ...validDelegation, status: 'weird' }] })
    ).toBeNull();
  });
});
