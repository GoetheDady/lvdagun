/**
 * @file Hub 会话:边界接口 + Pi 实现。
 *
 * 客户端永远不直接接触 Pi SDK,只通过 HubSession 接口与 Hub 交互。
 * V1 抽独立进程时,本模块整体迁移,接口签名不变。
 */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';

import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
} from '@earendil-works/pi-coding-agent';
import type { ChatMessage, HubEvent, PromptRequest } from '../../shared/ipc';
import { DATA_DIR } from './config';
import { getModelRuntime } from './runtime';

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
  dispose(): void;
}

/** 创建 Hub 会话所需的最小配置 */
export interface CreateHubSessionOptions {
  /** provider id,如 anthropic / openai / deepseek */
  provider: string;
  /** API Key;缺省时回落到环境变量(如 ANTHROPIC_API_KEY) */
  apiKey?: string;
  /** 模型 id,如 claude-sonnet-4-6 */
  modelId: string;
  /** 管家系统提示词;缺省用默认提示词 */
  systemPrompt?: string;
}

/** V0 默认系统提示词(后续挪到配置/资源文件) */
const DEFAULT_SYSTEM_PROMPT = '你是驴打滚,运行在用户电脑上的个人 AI 管家。回答简洁、直接、用中文。';

/**
 * 创建 Hub 会话。
 *
 * @param options - 模型与提示词配置
 * @returns 就绪的 Hub 会话
 * @throws 模型不存在或初始化失败
 */
export async function createHubSession(options: CreateHubSessionOptions): Promise<HubSession> {
  const modelRuntime = await getModelRuntime();
  if (options.apiKey) {
    await modelRuntime.setRuntimeApiKey(options.provider, options.apiKey);
  }

  const model = modelRuntime.getModel(options.provider, options.modelId);
  if (!model) {
    throw new Error(`未找到模型:${options.provider}/${options.modelId}`);
  }

  // 关闭 skills/上下文文件发现:项目里的 AGENTS.md、.agents/skills 是给编码代理用的,
  // 注入个人管家会产生干扰。cwd 用主目录,为 V1 文件工具铺路。
  // agentDir 指向自己的数据目录:扩展/提示词发现与 ~/.pi/agent 无关。
  const loader = new DefaultResourceLoader({
    cwd: homedir(),
    agentDir: DATA_DIR,
    systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
    noSkills: true,
    noContextFiles: true,
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: homedir(),
    agentDir: DATA_DIR,
    model,
    modelRuntime,
    resourceLoader: loader,
    // V0 纯对话:不启用任何工具(PRD 5.3:工具不在 V0 范围)
    noTools: 'all',
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory(),
  });

  return new PiHubSession(session);
}

/**
 * Pi 会话的 HubSession 实现:把 Pi 事件流翻译为协议事件流。
 *
 * 翻译职责说明:Pi 的消息对象没有 id 字段,协议要求消息带 id,
 * 所以 id 在边界处生成(user 在 prompt 时、assistant 在 message_start 时)。
 */
class PiHubSession implements HubSession {
  private readonly session: AgentSession;
  private readonly listeners = new Set<(event: HubEvent) => void>();
  private history: ChatMessage[] = [];
  /** 当前正在流式输出的 AI 消息(累计文本) */
  private streaming: { messageId: string; text: string } | null = null;
  private readonly unsubscribe: () => void;

  constructor(session: AgentSession) {
    this.session = session;
    this.unsubscribe = session.subscribe(this.handleEvent);
  }

  async prompt(request: PromptRequest): Promise<void> {
    const message: ChatMessage = { id: randomUUID(), role: 'user', text: request.text };
    this.history.push(message);
    this.emit({ type: 'user_message', message });
    try {
      await this.session.prompt(request.text);
    } catch (error) {
      this.emit({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      });
    }
  }

  async abort(): Promise<void> {
    await this.session.abort();
  }

  subscribe(listener: (event: HubEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getMessages(): ChatMessage[] {
    // 返回副本:外部修改不会破坏内部历史
    return [...this.history];
  }

  dispose(): void {
    this.unsubscribe();
    this.session.dispose();
  }

  private emit(event: HubEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /** Pi 事件 → 协议事件。只翻译 V0 对话需要的事件,其余忽略。 */
  private handleEvent = (event: AgentSessionEvent): void => {
    switch (event.type) {
      case 'message_start': {
        if (event.message.role === 'assistant') {
          this.streaming = { messageId: randomUUID(), text: '' };
          this.emit({ type: 'assistant_message_start', messageId: this.streaming.messageId });
        }
        break;
      }
      case 'message_update': {
        // 只转发文本增量;thinking_delta 是模型思考过程,不进对话流
        if (this.streaming && event.assistantMessageEvent.type === 'text_delta') {
          this.streaming.text += event.assistantMessageEvent.delta;
          this.emit({
            type: 'assistant_text_delta',
            messageId: this.streaming.messageId,
            delta: event.assistantMessageEvent.delta,
          });
        }
        break;
      }
      case 'message_end': {
        if (event.message.role === 'assistant' && this.streaming) {
          const message: ChatMessage = {
            id: this.streaming.messageId,
            role: 'assistant',
            text: this.streaming.text,
          };
          this.history.push(message);
          this.emit({ type: 'assistant_message_end', message });
          this.streaming = null;
        }
        break;
      }
      default:
        break;
    }
  };
}
