import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionRuntime,
} from '@earendil-works/pi-coding-agent';
import { sessionEntryToContextMessages } from '@earendil-works/pi-coding-agent';
import type {
  ActiveCompaction,
  AgentSessionState,
  AgentStreamEvent,
  AvailableModel,
  ChatMessage,
  ModelReference,
  ThinkingLevel,
} from '@lvdagun/protocol';

import { AgentBusyError, ModelUnavailableError, type HubSession } from './hub';
import { toJsonAgentEvent } from './pi-json-event';

const AUTO_TITLE_ENTRY_TYPE = 'lvdagun.auto-title-attempted';
const TITLE_INPUT_LIMIT = 2000;
const TITLE_TIMEOUT_MS = 15_000;
const TITLE_SYSTEM_PROMPT = `你负责为一段 AI 对话生成标题。只输出标题本身，不要引号、序号或解释。
要求：以中文为主，8 到 20 个字符；可保留必要的英文技术标识符；概括用户意图与结果；不得复述凭据、令牌、绝对路径或个人敏感信息。`;

/** 使用 Pi AgentSessionRuntime 的 Hub 会话实现 */
export class PiHubSession implements HubSession {
  readonly id: string;
  readonly createdAt: number;
  private readonly listeners = new Set<(event: AgentStreamEvent) => void>();
  private activeCompaction: ActiveCompaction | null = null;
  private modelWarning: string | null;
  private unsubscribeSession: (() => void) | null = null;

  /**
   * 创建 Pi Runtime 会话适配器并绑定当前会话事件。
   *
   * @param runtime - 可替换当前 AgentSession 的 Pi Runtime
   * @param modelWarning - 恢复会话模型失败时的非阻塞警告
   */
  constructor(
    private readonly runtime: AgentSessionRuntime,
    modelWarning: string | null = null
  ) {
    this.modelWarning = modelWarning;
    this.id = runtime.session.sessionId;
    this.createdAt = Date.now();
    this.bindSession(runtime.session);
    runtime.setRebindSession(async (session) => {
      this.bindSession(session);
    });
  }

  /**
   * 接受用户提示，前置校验通过后立即返回。
   *
   * @param text - 用户提示文本
   * @returns Pi 接受提示后解决的 Promise
   * @throws Agent 正在运行或 Pi 前置校验失败
   */
  async prompt(text: string): Promise<void> {
    const session = this.runtime.session;
    if (!session.isIdle) {
      throw new AgentBusyError();
    }

    await new Promise<void>((resolve, reject) => {
      let accepted = false;
      void session
        .prompt(text, {
          preflightResult: (ok) => {
            if (ok) {
              accepted = true;
              resolve();
            }
          },
        })
        .catch((error: unknown) => {
          if (!accepted) {
            reject(error);
            return;
          }
          console.error('Pi Agent 运行异常:', error);
        });
    });
  }

  /**
   * 订阅 Pi JSON 会话事件。
   *
   * @param listener - 事件回调
   * @returns 退订函数
   */
  subscribe(listener: (event: AgentStreamEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 读取当前 Pi 会话分支的完整展示历史。
   *
   * `session.messages` 是压缩后提供给模型的上下文，会省略已被摘要覆盖的旧消息；展示历史
   * 必须从 Pi 的追加式会话条目投影，才能保留压缩前消息及压缩分割线。
   *
   * @returns 当前分支中的完整结构化消息
   */
  getMessages(): ChatMessage[] {
    return this.runtime.session.sessionManager
      .getBranch()
      .flatMap((entry) => sessionEntryToContextMessages(entry));
  }

  /**
   * 读取 Agent 运行与思考等级状态。
   *
   * @returns 当前会话状态
   */
  getState(): AgentSessionState {
    const session = this.runtime.session;
    const model = session.model;
    if (!model) {
      throw new Error('Pi 会话没有可用模型');
    }
    return {
      sessionName: session.sessionName ?? null,
      isRunning: !session.isIdle || this.activeCompaction !== null,
      activeCompaction: this.activeCompaction ? { ...this.activeCompaction } : null,
      thinkingLevel: session.thinkingLevel,
      availableThinkingLevels: [...session.getAvailableThinkingLevels()],
      model: this.toAvailableModel(model),
      availableModels: this.runtime.services.modelRuntime
        .getAvailableSnapshot()
        .map((availableModel) => this.toAvailableModel(availableModel)),
      modelWarning: this.modelWarning,
    };
  }

  /**
   * 设置 Pi 原生会话名称并由 Pi 广播名称变化事件。
   *
   * @param title - 非空会话标题
   * @returns 无返回值
   */
  setSessionName(title: string): void {
    this.runtime.session.setSessionName(title);
  }

  /**
   * 中止 Agent 运行或上下文压缩并等待其稳定。
   *
   * @returns Agent 完全稳定后解决的 Promise
   */
  async abort(): Promise<void> {
    const session = this.runtime.session;
    session.abortCompaction();
    await session.abort();
  }

  /**
   * 设置 Pi 思考等级。
   *
   * @param level - 请求的思考等级
   * @returns 设置后的会话状态
   */
  async setThinkingLevel(level: ThinkingLevel): Promise<AgentSessionState> {
    this.assertIdle();
    this.runtime.session.setThinkingLevel(level);
    await this.runtime.services.settingsManager.flush();
    return this.getState();
  }

  /**
   * 设置当前会话模型并向全部客户端广播权威状态。
   *
   * @param reference - 跨 Provider 模型引用
   * @returns 设置后的权威会话状态
   */
  async setModel(reference: ModelReference): Promise<AgentSessionState> {
    this.assertIdle();
    const model = this.runtime.services.modelRuntime
      .getAvailableSnapshot()
      .find((candidate) => candidate.provider === reference.provider && candidate.id === reference.id);
    if (!model) {
      throw new ModelUnavailableError(reference);
    }

    await this.runtime.session.setModel(model);
    await this.runtime.services.settingsManager.flush();
    this.modelWarning = null;
    const state = this.getState();
    this.emit({ type: 'session_model_changed', state });
    return state;
  }

  /**
   * 释放 Pi Runtime 与事件订阅。
   *
   * @returns 资源释放完成后解决的 Promise
   */
  async dispose(): Promise<void> {
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    this.runtime.setRebindSession(undefined);
    await this.runtime.services.settingsManager.flush();
    await this.runtime.dispose();
  }

  /**
   * 将适配器绑定到 Runtime 当前的 AgentSession。
   *
   * @param session - 新的 Pi AgentSession
   * @returns 无返回值
   */
  private bindSession(session: AgentSession): void {
    this.unsubscribeSession?.();
    this.unsubscribeSession = session.subscribe(this.handleEvent);
  }

  /** @throws Agent 正在运行或压缩 */
  private assertIdle(): void {
    if (!this.runtime.session.isIdle || this.activeCompaction !== null) {
      throw new AgentBusyError();
    }
  }

  /**
   * 将 Pi 模型投影为客户端可展示的可用模型。
   *
   * @param model - Pi 模型对象
   * @returns 跨 Provider 的展示模型
   */
  private toAvailableModel(model: { provider: string; id: string; name: string }): AvailableModel {
    return {
      provider: model.provider,
      providerName:
        this.runtime.services.modelRuntime.getProvider(model.provider)?.name ?? model.provider,
      id: model.id,
      name: model.name,
    };
  }

  /** @param event - 要广播给当前会话全部客户端的事件 */
  private emit(event: AgentStreamEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /**
   * 转换并广播 Pi 进程内事件。
   *
   * @param event - Pi 进程内会话事件
   * @returns 无返回值
   */
  private readonly handleEvent = (event: AgentSessionEvent): void => {
    if (event.type === 'compaction_start') {
      this.activeCompaction = { reason: event.reason };
    } else if (event.type === 'compaction_end' || event.type === 'agent_settled') {
      this.activeCompaction = null;
    }

    const jsonEvent = toJsonAgentEvent(event);
    this.emit(jsonEvent);

    if (event.type === 'agent_settled') {
      void this.generateTitleOnce();
    }
  };

  /**
   * 在首次成功对话后尝试一次后台标题生成。
   *
   * 自定义条目先于网络请求落盘，确保失败或服务重启后都不会重复计费；生成结束时再次读取
   * `sessionName`，避免覆盖请求期间由用户设置的手动标题。
   *
   * @returns 后台尝试完成后的 Promise
   */
  private async generateTitleOnce(): Promise<void> {
    const session = this.runtime.session;
    const entries = session.sessionManager.getBranch();
    if (
      session.sessionName ||
      entries.some(
        (entry) => entry.type === 'custom' && entry.customType === AUTO_TITLE_ENTRY_TYPE
      )
    ) {
      return;
    }

    const messages = this.getMessages();
    const userMessage = messages.find((message) => message.role === 'user');
    const assistantMessage = messages.find(
      (message): message is Extract<ChatMessage, { role: 'assistant' }> =>
        message.role === 'assistant' && message.stopReason === 'stop'
    );
    if (!userMessage || !assistantMessage) {
      return;
    }

    session.sessionManager.appendCustomEntry(AUTO_TITLE_ENTRY_TYPE, { attemptedAt: Date.now() });
    const userText = this.getUserText(userMessage).slice(0, TITLE_INPUT_LIMIT);
    const assistantText = assistantMessage.content
      .filter((content) => content.type === 'text')
      .map((content) => content.text)
      .join('\n')
      .slice(0, TITLE_INPUT_LIMIT);
    if (!userText || !assistantText || !session.model) {
      return;
    }

    try {
      const stream = this.runtime.services.modelRuntime.streamSimple(
        session.model,
        {
          systemPrompt: TITLE_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: `用户请求：\n${userText}\n\n助手回答：\n${assistantText}`,
              timestamp: Date.now(),
            },
          ],
          tools: [],
        },
        { maxTokens: 64, signal: AbortSignal.timeout(TITLE_TIMEOUT_MS) }
      );
      const result = await stream.result();
      const title = this.parseGeneratedTitle(result);
      if (title && !session.sessionName) {
        session.setSessionName(title);
      }
    } catch (error) {
      console.error('自动生成会话标题失败:', error);
    }
  }

  /** @param message - 首条用户消息 @returns 纯文本内容 */
  private getUserText(message: Extract<ChatMessage, { role: 'user' }>): string {
    return typeof message.content === 'string'
      ? message.content
      : message.content
          .filter((content) => content.type === 'text')
          .map((content) => content.text)
          .join('\n');
  }

  /**
   * 校验模型输出，防止不合规标题或敏感数据进入持久化名称。
   *
   * @param message - 标题模型最终消息
   * @returns 合规标题；输出不合规时返回 null
   */
  private parseGeneratedTitle(message: Extract<ChatMessage, { role: 'assistant' }>): string | null {
    const title = message.content
      .filter((content) => content.type === 'text')
      .map((content) => content.text)
      .join('')
      .trim()
      .replace(/^标题[：:]\s*/, '')
      .replace(/^["'“‘]|["'”’]$/g, '')
      .trim();
    const length = [...title].length;
    const containsSensitiveText =
      /(?:\/Users\/|\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\|sk-[A-Za-z0-9_-]{8,}|(?:api[_ -]?key|token|密码|令牌)[：:=])/i.test(
        title
      );
    return length >= 8 && length <= 20 && !title.includes('\n') && !containsSensitiveText
      ? title
      : null;
  }
}
