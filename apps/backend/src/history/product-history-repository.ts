import type { ProductAgentRun } from '@lvdagun/protocol';

/** 产品会话在跨存储生命周期中的状态。 */
export type ProductSessionLifecycle =
  'creating' | 'active' | 'archiving' | 'archived' | 'deleting' | 'forking';

/** 产品分支持久化记录。 */
export interface StoredProductBranch {
  id: string;
  parentBranchId: string | null;
  forkedAtRunId: string | null;
  runs: ProductAgentRun[];
}

/** Pi 来源引用，不进入客户端协议。 */
export interface ProductSourceReference {
  itemId: string;
  sourceType: 'pi_entry' | 'pi_tool_call';
  sourceId: string;
}

/** 产品会话的完整持久化聚合。 */
export interface StoredProductSession {
  id: string;
  piSessionId: string | null;
  title: string | null;
  status: 'active' | 'archived';
  lifecycleState: ProductSessionLifecycle;
  currentBranchId: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  branches: StoredProductBranch[];
  sourceReferences: ProductSourceReference[];
}

/** 二进制附件的客户端读取结果。 */
export interface StoredProductBlob {
  mimeType: string;
  data: string;
}

/** 产品历史持久化边界。 */
export interface ProductHistoryRepository {
  /** @returns 是否首次创建 V1 数据库 */
  initialize(): boolean;
  /** @returns 旧 Pi 会话是否已经完成一次性清理 */
  isLegacyCutoverComplete(): boolean;
  /** 标记旧 Pi 会话已经完成一次性清理。 */
  markLegacyCutoverComplete(): void;
  /** @returns 全部产品会话聚合 */
  listSessions(): StoredProductSession[];
  /** @param sessionId - 产品会话标识 @returns 会话；不存在时返回 null */
  loadSession(sessionId: string): StoredProductSession | null;
  /** @param session - 要原子保存的完整会话 @returns 无返回值 */
  saveSession(session: StoredProductSession): void;
  /** @param sessionId - 产品会话标识 @returns 无返回值 */
  deleteSession(sessionId: string): void;
  /** @param sessionId - 产品会话标识 @param mimeType - MIME 类型 @param data - 原始数据 @returns BLOB 标识 */
  putBlob(sessionId: string, mimeType: string, data: Uint8Array): string;
  /** @param sessionId - 产品会话标识 @returns 会话内全部 BLOB 的 Base64 读取投影 */
  loadBlobs(sessionId: string): Record<string, StoredProductBlob>;
  /** @returns 关闭数据库后的无返回值 */
  close(): void;
}
