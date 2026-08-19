import {
  sessionEntryToContextMessages,
  type ExtensionContext,
  type ExtensionFactory,
  type ModelRuntime,
  type SessionEntry,
} from '@earendil-works/pi-coding-agent';
import type { ChatMessage } from '@lvdagun/protocol';

const ATTEMPT_ENTRY_TYPE = 'lvdagun.auto-session-title-attempted';
const INPUT_LIMIT = 2000;
const TIMEOUT_MS = 15_000;
const SYSTEM_PROMPT = `你负责为一段 AI 对话生成标题。只输出标题本身，不要引号、序号或解释。
要求：以中文为主，8 到 20 个字符；可保留必要的英文技术标识符；概括用户意图与结果；不得复述凭据、令牌、绝对路径或个人敏感信息。`;

/** 自动标题模型所需的首轮成功对话。 */
interface AutoTitleSource {
  userText: string;
  assistantText: string;
}

/**
 * 创建自动会话标题内置 Extension。
 *
 * @param modelRuntime - Agent Hub 已创建并复用的 Pi 模型运行时
 * @returns 供 Pi ResourceLoader 显式加载的隐藏 Extension
 */
export function createAutoSessionTitleExtension(modelRuntime: Pick<ModelRuntime, 'streamSimple'>): {
  name: string;
  hidden: true;
  factory: ExtensionFactory;
} {
  return {
    name: 'lvdagun-auto-session-title',
    hidden: true,
    factory: (pi) => {
      let latestRunSucceeded = false;
      let activeAbortController: AbortController | null = null;

      pi.on('agent_start', () => {
        latestRunSucceeded = false;
      });

      pi.on('agent_end', (event) => {
        latestRunSucceeded = event.messages.some(
          (message) => message.role === 'assistant' && message.stopReason === 'stop'
        );
      });

      pi.on('agent_settled', (_event, context) => {
        if (!latestRunSucceeded || activeAbortController) {
          return;
        }
        latestRunSucceeded = false;
        const abortController = new AbortController();
        activeAbortController = abortController;
        const task = generateTitle(pi, context, modelRuntime, abortController.signal).finally(
          () => {
            activeAbortController = null;
          }
        );
        void task.catch((error: unknown) => {
          if (!abortController.signal.aborted) {
            console.error('自动生成会话标题失败:', error);
          }
        });
      });

      pi.on('session_shutdown', () => {
        activeAbortController?.abort();
      });
    },
  };
}

/**
 * 在首次成功运行完全结算后尝试一次标题生成。
 *
 * 尝试标记先于网络请求写入；即使请求失败、中止或进程重启，也不会再次调用模型。
 *
 * @param pi - Pi Extension 接口
 * @param context - 当前已结算会话的 Extension 上下文
 * @param modelRuntime - 用于发起轻量标题请求的模型运行时
 * @param shutdownSignal - Extension 生命周期中止信号
 * @returns 后台标题任务完成后的 Promise
 */
async function generateTitle(
  pi: Parameters<ExtensionFactory>[0],
  context: ExtensionContext,
  modelRuntime: Pick<ModelRuntime, 'streamSimple'>,
  shutdownSignal: AbortSignal
): Promise<void> {
  if (
    pi.getSessionName() ||
    context.sessionManager
      .getEntries()
      .some((entry) => entry.type === 'custom' && entry.customType === ATTEMPT_ENTRY_TYPE)
  ) {
    return;
  }

  const source = getAutoTitleSource(context.sessionManager.getBranch());
  if (!source || !source.userText || !source.assistantText || !context.model) {
    return;
  }

  pi.appendEntry(ATTEMPT_ENTRY_TYPE, { attemptedAt: Date.now() });
  if (pi.getSessionName()) {
    return;
  }

  shutdownSignal.throwIfAborted();
  const requestSignal = AbortSignal.any([shutdownSignal, AbortSignal.timeout(TIMEOUT_MS)]);
  const stream = modelRuntime.streamSimple(
    context.model,
    {
      systemPrompt: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `用户请求：\n${source.userText}\n\n助手回答：\n${source.assistantText}`,
          timestamp: Date.now(),
        },
      ],
      tools: [],
    },
    { maxTokens: 64, signal: requestSignal }
  );
  const result = await stream.result();
  requestSignal.throwIfAborted();
  if (result.stopReason !== 'stop' || pi.getSessionName()) {
    return;
  }

  const title = parseGeneratedSessionTitle(result);
  if (title) {
    pi.setSessionName(title);
  }
}

/**
 * 从当前分支读取自动标题所需的首条用户消息和首条成功回复。
 *
 * @param entries - 当前 Pi 会话分支条目
 * @returns 截断后的标题输入；对话尚未成功完成时返回 null
 */
function getAutoTitleSource(entries: SessionEntry[]): AutoTitleSource | null {
  const messages = entries.flatMap(sessionEntryToContextMessages);
  const userMessage = messages.find((message) => message.role === 'user');
  const assistantMessage = messages.find(
    (message): message is Extract<ChatMessage, { role: 'assistant' }> =>
      message.role === 'assistant' && message.stopReason === 'stop'
  );
  if (!userMessage || userMessage.role !== 'user' || !assistantMessage) {
    return null;
  }

  const userText = getUserText(userMessage).slice(0, INPUT_LIMIT);
  const assistantText = assistantMessage.content
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('\n')
    .slice(0, INPUT_LIMIT);
  return { userText, assistantText };
}

/**
 * 校验模型输出，防止不合规标题或敏感数据进入持久化名称。
 *
 * @param message - 标题模型最终消息
 * @returns 合规标题；输出不合规时返回 null
 */
function parseGeneratedSessionTitle(
  message: Extract<ChatMessage, { role: 'assistant' }>
): string | null {
  const title = message.content
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('')
    .trim()
    .replace(/^标题[：:]\s*/, '')
    .replace(/^["'“‘]|["'”’]$/g, '')
    .trim();
  const length = [...title].length;
  const chineseCharacterCount = title.match(/\p{Script=Han}/gu)?.length ?? 0;
  const meaningfulCharacterCount = title.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const containsSensitiveText =
    /(?:\/Users\/|\/[A-Za-z0-9._-]+\/|[A-Za-z]:\\|sk-[A-Za-z0-9_-]{8,}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|1[3-9]\d{9}|\d{17}[\dXx]|(?:api[_ -]?key|token|密码|令牌)[：:=])/i.test(
      title
    );
  return length >= 8 &&
    length <= 20 &&
    chineseCharacterCount >= 4 &&
    chineseCharacterCount * 2 >= meaningfulCharacterCount &&
    !title.includes('\n') &&
    !containsSensitiveText
    ? title
    : null;
}

/** @param message - 用户消息 @returns 所有文本块拼接后的纯文本 */
function getUserText(message: Extract<ChatMessage, { role: 'user' }>): string {
  return typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((content) => content.type === 'text')
        .map((content) => content.text)
        .join('\n');
}
