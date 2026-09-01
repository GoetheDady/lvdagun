/**
 * useSessionList / useHubConnection 测试用的 rpc-client stub。
 *
 * 会话列表走真实订阅路径：初始快照复用测试文件里已 mock 的 api.listSessions；
 * useHubConnection 需要连接状态订阅，测试假定连接正常。
 *
 * @returns vi.mock('@/services/rpc-client') 工厂可直接返回的模块形状
 */
export async function rpcClientMockFactory(): Promise<{
  getRpcConnection: () => {
    getStatus: () => string;
    subscribeStatus: () => () => void;
    subscribeSessionList: (sub: { onList: (sessions: unknown) => void }) => Promise<() => void>;
  };
}> {
  const { api } = await import('@/services/api-client');
  return {
    getRpcConnection: () => ({
      getStatus: () => 'connected',
      subscribeStatus: () => () => {},
      subscribeSessionList: async (sub) => {
        sub.onList(await api.listSessions());
        return () => {};
      },
    }),
  };
}
