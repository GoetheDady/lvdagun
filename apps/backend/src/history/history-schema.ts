/** 产品历史数据库 schema 版本。 */
export const HISTORY_DATABASE_SCHEMA_VERSION = 1;

/** V1 产品历史数据库结构。 */
export const HISTORY_SCHEMA_SQL = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS schema_info (
    version INTEGER NOT NULL,
    legacy_cutover_complete INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    pi_session_id TEXT UNIQUE,
    title TEXT,
    status TEXT NOT NULL,
    lifecycle_state TEXT NOT NULL,
    current_branch_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    parent_branch_id TEXT REFERENCES branches(id) ON DELETE CASCADE,
    forked_at_run_id TEXT,
    position INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    status TEXT NOT NULL,
    accepted_at INTEGER NOT NULL,
    started_at INTEGER,
    settled_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS timeline_items (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS source_references (
    item_id TEXT NOT NULL REFERENCES timeline_items(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    PRIMARY KEY (item_id, source_type)
  );

  CREATE TABLE IF NOT EXISTS blobs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    mime_type TEXT NOT NULL,
    data BLOB NOT NULL
  );

  CREATE INDEX IF NOT EXISTS branches_session_position
    ON branches(session_id, position);
  CREATE INDEX IF NOT EXISTS runs_branch_position
    ON agent_runs(branch_id, position);
  CREATE INDEX IF NOT EXISTS items_run_position
    ON timeline_items(run_id, position);
`;
