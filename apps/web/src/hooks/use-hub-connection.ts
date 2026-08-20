import { useCallback, useSyncExternalStore } from 'react';

import {
  getRpcConnection,
  type HubConnectionStatus,
} from '@/services/rpc-client';

export interface HubConnection {
  status: HubConnectionStatus;
  /** @returns 无返回值 */
  reconnect(): void;
}

/**
 * 订阅应用级 Hub 连接状态。
 *
 * @returns Hub 连接状态与手动重连命令
 */
export function useHubConnection(): HubConnection {
  const connection = getRpcConnection();
  const status = useSyncExternalStore(
    connection.subscribeStatus,
    connection.getStatus,
    connection.getStatus
  );
  const reconnect = useCallback(() => connection.reconnect(), [connection]);
  return { status, reconnect };
}
