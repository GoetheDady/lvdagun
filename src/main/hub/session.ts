/**
 * @file Hub 会话边界接口。
 *
 * 客户端永远不直接接触 Pi SDK,只通过本接口与 Hub 交互。
 * V1 抽独立进程时,本接口的实现整体迁移,接口签名不变。
 */
import type { ChatMessage, HubEvent, PromptRequest } from '../../shared/ipc';

/** Hub 会话:内核与客户端之间唯一的契约 */
export interface HubSession {
  /**
   * 发送用户消息,处理完整回复(含流式事件推送)。
   *
   * @param request - 用户消息请求
   */
  prompt(request: PromptRequest): Promise<void>;

  /** 中止当前正在进行的生成 */
  abort(): Promise<void>;

  /**
   * 订阅 Hub 事件流。
   *
   * @param listener - 事件回调
   * @returns 退订函数
   */
  subscribe(listener: (event: HubEvent) => void): () => void;

  /** 当前会话的完整消息历史(客户端重开窗口时恢复) */
  getMessages(): ChatMessage[];

  /** 释放会话资源(应用退出时调用) */
  dispose(): Promise<void>;
}
