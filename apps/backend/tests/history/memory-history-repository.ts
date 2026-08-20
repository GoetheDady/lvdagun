import { randomUUID } from 'node:crypto';

import type {
  ProductHistoryRepository,
  StoredProductBlob,
  StoredProductSession,
} from '../../src/history/product-history-repository';

/** 测试使用的无 IO 产品历史仓储。 */
export class MemoryHistoryRepository implements ProductHistoryRepository {
  /** 测试按需注入的写入失败。 */
  saveFailure: Error | null = null;
  private initialized = false;
  private legacyCutoverComplete = false;
  private readonly sessions = new Map<string, StoredProductSession>();
  private readonly blobs = new Map<string, Map<string, StoredProductBlob>>();

  /** @returns 是否首次初始化 */
  initialize(): boolean {
    const first = !this.initialized;
    this.initialized = true;
    return first;
  }

  /** @returns 是否已经完成旧会话清理 */
  isLegacyCutoverComplete(): boolean {
    return this.legacyCutoverComplete;
  }

  /** 标记旧会话清理完成。 */
  markLegacyCutoverComplete(): void {
    this.legacyCutoverComplete = true;
  }

  /** @returns 全部会话 */
  listSessions(): StoredProductSession[] {
    return [...this.sessions.values()].map((session) => structuredClone(session));
  }

  /** @param sessionId - 会话 @returns 聚合或 null */
  loadSession(sessionId: string): StoredProductSession | null {
    const session = this.sessions.get(sessionId);
    return session ? structuredClone(session) : null;
  }

  /** @param session - 聚合 */
  saveSession(session: StoredProductSession): void {
    if (this.saveFailure) throw this.saveFailure;
    this.sessions.set(session.id, structuredClone(session));
  }

  /** @param sessionId - 会话 */
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.blobs.delete(sessionId);
  }

  /** @param sessionId - 会话 @param mimeType - MIME @param data - 数据 @returns BLOB id */
  putBlob(sessionId: string, mimeType: string, data: Uint8Array): string {
    const id = randomUUID();
    const blobs = this.blobs.get(sessionId) ?? new Map();
    blobs.set(id, { mimeType, data: Buffer.from(data).toString('base64') });
    this.blobs.set(sessionId, blobs);
    return id;
  }

  /** @param sessionId - 会话 @returns BLOB 投影 */
  loadBlobs(sessionId: string): Record<string, StoredProductBlob> {
    return Object.fromEntries(this.blobs.get(sessionId) ?? []);
  }

  /** @returns 无返回值 */
  close(): void {}
}
