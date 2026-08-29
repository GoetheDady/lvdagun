import { describe, expect, it } from 'vitest';

import { projectTodoDetails } from '../../../src/extensions/todo/todo-projection';

describe('projectTodoDetails', () => {
  it('按创建顺序投影未删除步骤并隐藏上游依赖', () => {
    expect(
      projectTodoDetails({
        action: 'update',
        params: { id: 2, status: 'in_progress' },
        tasks: [
          { id: 1, subject: '核对接口', status: 'completed' },
          {
            id: 2,
            subject: '实现后端',
            activeForm: '正在实现后端',
            description: '接入 Extension',
            status: 'in_progress',
            blockedBy: [1],
          },
          { id: 3, subject: '旧步骤', status: 'deleted' },
        ],
        nextId: 4,
      })
    ).toEqual({
      steps: [
        { id: 1, subject: '核对接口', status: 'completed' },
        {
          id: 2,
          subject: '实现后端',
          activeForm: '正在实现后端',
          description: '接入 Extension',
          status: 'in_progress',
        },
      ],
    });
  });

  it('区分合法清空和非法快照', () => {
    expect(projectTodoDetails({ action: 'clear', params: {}, tasks: [], nextId: 1 })).toBeNull();
    expect(
      projectTodoDetails({
        action: 'update',
        params: {},
        tasks: [{ id: 1, subject: '', status: 'completed' }],
        nextId: 2,
      })
    ).toBeUndefined();
  });
});
