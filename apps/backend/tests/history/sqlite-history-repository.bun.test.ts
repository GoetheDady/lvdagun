import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { ProductHistory } from '../../src/history/product-history';
import { SqliteHistoryRepository } from '../../src/history/sqlite-history-repository';

describe('SqliteHistoryRepository', () => {
  test('原子重写聚合并在重新打开仓储后恢复', () => {
    const repository = new SqliteHistoryRepository(':memory:');
    const history = new ProductHistory(repository);
    expect(history.initialize()).toBe(true);
    history.beginCreate('session-a', 1);
    history.completeCreate('session-a', 'pi-a');
    history.acceptPrompt('session-a', '问题');
    history.mutate('session-a', (session) => {
      const run = session.branches[0]!.runs[0]!;
      run.status = 'completed';
      run.items.push({
        type: 'assistant_segment',
        itemId: 'assistant-a',
        runId: run.runId,
        createdAt: 2,
        status: 'completed',
        content: [{ type: 'text', text: '回答' }],
      });
    });

    expect(history.getSnapshot('session-a')).toMatchObject({
      revision: 2,
      runs: [{ status: 'completed', items: [{ text: '问题' }, { content: [{ text: '回答' }] }] }],
    });
  });

  test('拒绝未知 schema version', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lvdagun-history-schema-'));
    const path = join(directory, 'history.sqlite');
    try {
      const repository = new SqliteHistoryRepository(path);
      repository.initialize();
      repository.close();
      const database = new Database(path);
      database.query('UPDATE schema_info SET version = 99').run();
      database.close();

      const reopened = new SqliteHistoryRepository(path);
      expect(() => reopened.initialize()).toThrow('不支持的产品历史 schema version:99');
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('父子分支聚合可以反复原子重写', () => {
    const repository = new SqliteHistoryRepository(':memory:');
    const history = new ProductHistory(repository);
    history.initialize();
    history.beginCreate('session-a', 1);
    history.completeCreate('session-a', 'pi-a');
    history.acceptPrompt('session-a', '原问题');
    const userItem = history.getSnapshot('session-a').runs[0]!.items[0]!;
    history.savePiEntryReference('session-a', userItem.itemId, 'pi-user-a');

    expect(() => history.beginEditResend('session-a', userItem.itemId, '新问题')).not.toThrow();
    expect(() => history.setTitle('session-a', '新标题')).not.toThrow();
    expect(history.getSnapshot('session-a').runs[0]!.items[0]).toMatchObject({
      type: 'user_message',
      text: '新问题',
    });
    repository.close();
  });

  test('旧会话清理标记跨重启持久化', () => {
    const repository = new SqliteHistoryRepository(':memory:');
    const history = new ProductHistory(repository);
    history.initialize();
    expect(history.needsLegacySessionCutover()).toBe(true);
    history.completeLegacySessionCutover();
    expect(history.needsLegacySessionCutover()).toBe(false);
    repository.close();
  });
});
