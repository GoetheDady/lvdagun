import { describe, expect, it } from 'vitest';

import { SUBAGENT_AGENTS, formatAgentCatalog } from '../../../src/extensions/subagent/subagent-agents';

describe('SUBAGENT_AGENTS', () => {
  it('内置四个固定角色', () => {
    expect(Object.keys(SUBAGENT_AGENTS).sort()).toEqual(
      ['planner', 'reviewer', 'scout', 'worker'].sort()
    );
    for (const agent of Object.values(SUBAGENT_AGENTS)) {
      expect(agent.systemPrompt.trim().length).toBeGreaterThan(20);
      expect(agent.tools.length).toBeGreaterThan(0);
    }
  });

  it('scout 与 reviewer 只读,不包含写工具', () => {
    for (const name of ['scout', 'reviewer'] as const) {
      expect(SUBAGENT_AGENTS[name].tools).not.toContain('edit');
      expect(SUBAGENT_AGENTS[name].tools).not.toContain('write');
    }
  });

  it('任何子 Agent 都不能递归委派', () => {
    for (const agent of Object.values(SUBAGENT_AGENTS)) {
      expect(agent.tools).not.toContain('delegate');
      expect(agent.tools).not.toContain('todo');
    }
  });

  it('能力清单列出全部角色', () => {
    const catalog = formatAgentCatalog();
    for (const name of Object.keys(SUBAGENT_AGENTS)) {
      expect(catalog).toContain(name);
    }
  });
});
