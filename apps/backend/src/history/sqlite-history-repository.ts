import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { Database } from 'bun:sqlite';
import type { ProductAgentRun, ProductTimelineItem } from '@lvdagun/protocol';

import { HISTORY_DATABASE_SCHEMA_VERSION, HISTORY_SCHEMA_SQL } from './history-schema';
import type {
  ProductHistoryRepository,
  ProductSessionLifecycle,
  ProductSourceReference,
  StoredProductBranch,
  StoredProductSession,
} from './product-history-repository';

interface SessionRow {
  id: string;
  pi_session_id: string | null;
  title: string | null;
  status: 'active' | 'archived';
  lifecycle_state: ProductSessionLifecycle;
  current_branch_id: string;
  revision: number;
  created_at: number;
  updated_at: number;
}

interface BranchRow {
  id: string;
  parent_branch_id: string | null;
  forked_at_run_id: string | null;
}

interface RunRow {
  id: string;
  branch_id: string;
  status: ProductAgentRun['status'];
  accepted_at: number;
  started_at: number | null;
  settled_at: number | null;
}

interface ItemRow {
  run_id: string;
  payload: string;
}

interface SourceRow {
  item_id: string;
  source_type: ProductSourceReference['sourceType'];
  source_id: string;
}

/** Bun SQLite 产品历史仓储。 */
export class SqliteHistoryRepository implements ProductHistoryRepository {
  private readonly database: Database;

  /** @param path - SQLite 文件路径；测试可使用 `:memory:` */
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.database = new Database(path, { create: true, strict: true });
    if (path !== ':memory:') {
      chmodSync(path, 0o600);
    }
  }

  /** @returns 是否首次创建 V1 schema */
  initialize(): boolean {
    const hasSchemaInfo = this.database
      .query<{ count: number }, []>(
        "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'schema_info'"
      )
      .get()?.count;
    if (hasSchemaInfo) {
      const version = this.database
        .query<{ version: number }, []>('SELECT version FROM schema_info')
        .get()?.version;
      if (version !== HISTORY_DATABASE_SCHEMA_VERSION) {
        throw new Error(`不支持的产品历史 schema version:${String(version)}`);
      }
      this.database.exec(HISTORY_SCHEMA_SQL);
      return false;
    }

    this.database.transaction(() => {
      this.database.exec(HISTORY_SCHEMA_SQL);
      this.database
        .query('INSERT INTO schema_info(version, legacy_cutover_complete) VALUES (?, 0)')
        .run(HISTORY_DATABASE_SCHEMA_VERSION);
    })();
    return true;
  }

  /** @returns 旧 Pi 会话是否已经完成一次性清理 */
  isLegacyCutoverComplete(): boolean {
    return (
      this.database
        .query<{ complete: number }, []>(
          'SELECT legacy_cutover_complete AS complete FROM schema_info'
        )
        .get()?.complete === 1
    );
  }

  /** 标记旧 Pi 会话已经完成一次性清理。 */
  markLegacyCutoverComplete(): void {
    this.database.query('UPDATE schema_info SET legacy_cutover_complete = 1').run();
  }

  /** @returns 全部会话聚合 */
  listSessions(): StoredProductSession[] {
    return this.database
      .query<SessionRow, []>('SELECT * FROM sessions ORDER BY updated_at DESC')
      .all()
      .map((row) => this.hydrateSession(row));
  }

  /** @param sessionId - 产品会话标识 @returns 会话或 null */
  loadSession(sessionId: string): StoredProductSession | null {
    const row = this.database
      .query<SessionRow, [string]>('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId);
    return row ? this.hydrateSession(row) : null;
  }

  /** @param session - 完整会话聚合 @returns 无返回值 */
  saveSession(session: StoredProductSession): void {
    this.database.transaction(() => {
      this.database
        .query(
          `INSERT INTO sessions(
            id, pi_session_id, title, status, lifecycle_state, current_branch_id,
            revision, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            pi_session_id = excluded.pi_session_id,
            title = excluded.title,
            status = excluded.status,
            lifecycle_state = excluded.lifecycle_state,
            current_branch_id = excluded.current_branch_id,
            revision = excluded.revision,
            updated_at = excluded.updated_at`
        )
        .run(
          session.id,
          session.piSessionId,
          session.title,
          session.status,
          session.lifecycleState,
          session.currentBranchId,
          session.revision,
          session.createdAt,
          session.updatedAt
        );

      this.database
        .query(
          `DELETE FROM source_references WHERE item_id IN (
            SELECT timeline_items.id FROM timeline_items
            JOIN agent_runs ON agent_runs.id = timeline_items.run_id
            JOIN branches ON branches.id = agent_runs.branch_id
            WHERE branches.session_id = ?
          )`
        )
        .run(session.id);
      this.database
        .query(
          `DELETE FROM timeline_items WHERE run_id IN (
            SELECT agent_runs.id FROM agent_runs
            JOIN branches ON branches.id = agent_runs.branch_id
            WHERE branches.session_id = ?
          )`
        )
        .run(session.id);
      this.database
        .query(
          `DELETE FROM agent_runs WHERE branch_id IN (
            SELECT id FROM branches WHERE session_id = ?
          )`
        )
        .run(session.id);
      this.database.query('DELETE FROM branches WHERE session_id = ?').run(session.id);
      for (const [branchPosition, branch] of session.branches.entries()) {
        this.database
          .query(
            `INSERT INTO branches(
              id, session_id, parent_branch_id, forked_at_run_id, position
            ) VALUES (?, ?, ?, ?, ?)`
          )
          .run(branch.id, session.id, branch.parentBranchId, branch.forkedAtRunId, branchPosition);
        for (const [runPosition, run] of branch.runs.entries()) {
          this.database
            .query(
              `INSERT INTO agent_runs(
                id, branch_id, position, status, accepted_at, started_at, settled_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              run.runId,
              branch.id,
              runPosition,
              run.status,
              run.acceptedAt,
              run.startedAt,
              run.settledAt
            );
          for (const [itemPosition, item] of run.items.entries()) {
            this.database
              .query(
                'INSERT INTO timeline_items(id, run_id, position, kind, payload) VALUES (?, ?, ?, ?, ?)'
              )
              .run(item.itemId, run.runId, itemPosition, item.type, JSON.stringify(item));
          }
        }
      }
      for (const reference of session.sourceReferences) {
        this.database
          .query('INSERT INTO source_references(item_id, source_type, source_id) VALUES (?, ?, ?)')
          .run(reference.itemId, reference.sourceType, reference.sourceId);
      }
    })();
  }

  /** @param sessionId - 产品会话标识 @returns 无返回值 */
  deleteSession(sessionId: string): void {
    this.database.query('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  /** @param sessionId - 会话 @param mimeType - MIME @param data - 数据 @returns BLOB id */
  putBlob(sessionId: string, mimeType: string, data: Uint8Array): string {
    const id = randomUUID();
    this.database
      .query('INSERT INTO blobs(id, session_id, mime_type, data) VALUES (?, ?, ?, ?)')
      .run(id, sessionId, mimeType, data);
    return id;
  }

  /** @param sessionId - 会话 @returns 按 id 索引的 Base64 BLOB */
  loadBlobs(sessionId: string): Record<string, { mimeType: string; data: string }> {
    const rows = this.database
      .query<{ id: string; mime_type: string; data: Uint8Array }, [string]>(
        'SELECT id, mime_type, data FROM blobs WHERE session_id = ?'
      )
      .all(sessionId);
    return Object.fromEntries(
      rows.map((row) => [
        row.id,
        { mimeType: row.mime_type, data: Buffer.from(row.data).toString('base64') },
      ])
    );
  }

  /** @returns 无返回值 */
  close(): void {
    this.database.close(false);
  }

  /** @param row - sessions 行 @returns 完整会话 */
  private hydrateSession(row: SessionRow): StoredProductSession {
    const branches = this.database
      .query<BranchRow, [string]>(
        'SELECT id, parent_branch_id, forked_at_run_id FROM branches WHERE session_id = ? ORDER BY position'
      )
      .all(row.id)
      .map((branch): StoredProductBranch => {
        const runs = this.database
          .query<RunRow, [string]>(
            `SELECT id, branch_id, status, accepted_at, started_at, settled_at
             FROM agent_runs WHERE branch_id = ? ORDER BY position`
          )
          .all(branch.id)
          .map((run): ProductAgentRun => ({
            runId: run.id,
            status: run.status,
            acceptedAt: run.accepted_at,
            startedAt: run.started_at,
            settledAt: run.settled_at,
            items: this.database
              .query<ItemRow, [string]>(
                'SELECT run_id, payload FROM timeline_items WHERE run_id = ? ORDER BY position'
              )
              .all(run.id)
              .map((item) => JSON.parse(item.payload) as ProductTimelineItem),
          }));
        return {
          id: branch.id,
          parentBranchId: branch.parent_branch_id,
          forkedAtRunId: branch.forked_at_run_id,
          runs,
        };
      });
    const sourceReferences = this.database
      .query<SourceRow, [string]>(
        `SELECT source_references.item_id, source_references.source_type, source_references.source_id
         FROM source_references
         JOIN timeline_items ON timeline_items.id = source_references.item_id
         JOIN agent_runs ON agent_runs.id = timeline_items.run_id
         JOIN branches ON branches.id = agent_runs.branch_id
         WHERE branches.session_id = ?`
      )
      .all(row.id)
      .map((source) => ({
        itemId: source.item_id,
        sourceType: source.source_type,
        sourceId: source.source_id,
      }));
    return {
      id: row.id,
      piSessionId: row.pi_session_id,
      title: row.title,
      status: row.status,
      lifecycleState: row.lifecycle_state,
      currentBranchId: row.current_branch_id,
      revision: row.revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      branches,
      sourceReferences,
    };
  }
}
