/**
 * @file 子 Agent 的内嵌会话执行器。
 *
 * 每次委派在 Agent Hub 进程内创建一个独立的 Pi 会话:上下文与父会话完全隔离,
 * 但复用已配置的 Provider 凭据;会话 JSONL 持久化在独立的 subagent-sessions 目录,
 * 因此不会出现在产品会话列表中。
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { ThinkingLevel } from '@earendil-works/pi-agent-core';
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  ModelRuntime,
  SessionManager as PiSessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import type { SubagentAgent } from './subagent-agents';
import type { SubagentDelegation } from '@lvdagun/protocol';

/** 单个子 Agent 结果文本上限;超出截断,与官方 subagent 示例的容量策略一致。 */
const RESULT_TEXT_LIMIT = 50 * 1024;

/** 子 Agent 继承父会话使用的 Pi 模型对象;从会话创建参数中取型避免直接引用 any。 */
type SubagentModel = NonNullable<Parameters<typeof createAgentSessionFromServices>[0]['model']>;

/** 执行一次子 Agent 委派所需的输入。 */
export interface SubagentTaskInput {
  agent: SubagentAgent;
  task: string;
  /** 父会话工作目录,子 Agent 在同一工作区中执行 */
  cwd: string;
  /** 继承父会话当前的模型对象 */
  model: SubagentModel;
  /** 继承父会话当前的思考等级;模型不支持时可为空 */
  thinkingLevel?: ThinkingLevel;
  /** 父 Agent 工具调用的中止信号;中止会级联停止子会话 */
  signal: AbortSignal;
  /** 每次进展变化时收到最新的委派投影 */
  onProgress: (delegation: SubagentDelegation) => void;
}

/** 子 Agent 运行器:执行一次委派并返回最终投影。 */
export interface SubagentRunner {
  run(input: SubagentTaskInput): Promise<SubagentDelegation>;
}

/**
 * 创建基于内嵌 Pi 会话的子 Agent 运行器。
 *
 * @param options.dataDir - Pi 数据目录,子会话存储在其中的 subagent-sessions 子目录
 * @param options.getRuntime - 共享的模型运行时(与父会话同一份凭据)
 * @returns 子 Agent 运行器
 */
export function createSubagentRunner(options: {
  dataDir: string;
  getRuntime: () => Promise<ModelRuntime>;
}): SubagentRunner {
  const { dataDir } = options;
  return {
    async run(input: SubagentTaskInput): Promise<SubagentDelegation> {
      const startedAt = Date.now();
      const runtime = await options.getRuntime();
      const sessionDir = join(dataDir, 'subagent-sessions');
      await mkdir(sessionDir, { recursive: true, mode: 0o700 });
      const sessionManager = PiSessionManager.create(input.cwd, sessionDir);
      const childSessionId = sessionManager.getSessionId();
      const settingsManager = SettingsManager.create(input.cwd, dataDir, {
        projectTrusted: true,
      });
      const services = await createAgentSessionServices({
        cwd: input.cwd,
        agentDir: dataDir,
        modelRuntime: runtime,
        settingsManager,
        resourceLoaderOptions: {
          systemPrompt: input.agent.systemPrompt,
          noExtensions: true,
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
        },
      });
      const { session } = await createAgentSessionFromServices({
        services,
        sessionManager,
        model: input.model,
        thinkingLevel: input.thinkingLevel,
        tools: input.agent.tools,
      });

      let steps = 0;
      let activity: string | null = null;
      let aborted = false;

      /**
       * @param patch - 相对当前投影的覆盖字段
       * @returns 推给父工具的最新投影
       */
      const report = (patch: Partial<SubagentDelegation>): SubagentDelegation => {
        const delegation: SubagentDelegation = {
          id: childSessionId,
          agent: input.agent.name,
          task: input.task,
          status: 'running',
          childSessionId,
          result: null,
          usage: null,
          error: null,
          steps,
          activity,
          startedAt,
          endedAt: null,
          ...patch,
        };
        input.onProgress(delegation);
        return delegation;
      };

      const unsubscribe = session.subscribe((event) => {
        if (event.type === 'tool_execution_start') {
          steps += 1;
          activity = `正在使用 ${event.toolName}`;
          report({});
        }
      });
      const handleAbort = (): void => {
        aborted = true;
        void session.abort().catch(() => undefined);
      };
      input.signal.addEventListener('abort', handleAbort, { once: true });

      try {
        await session.prompt(input.task);
      } finally {
        input.signal.removeEventListener('abort', handleAbort);
        unsubscribe();
      }

      // 失败与用量从持久化的会话分支里取权威值,而不是拼执行过程中的瞬时事件。
      const assistantMessages = session.sessionManager
        .getBranch()
        .flatMap((entry) => (entry.type === 'message' ? [entry.message] : []))
        .filter((message) => message.role === 'assistant');
      const last = assistantMessages.at(-1);
      const usage = assistantMessages.reduce(
        (acc, message) => {
          if (message.role !== 'assistant' || !message.usage) return acc;
          return {
            turns: acc.turns + 1,
            inputTokens: acc.inputTokens + (message.usage.input ?? 0),
            outputTokens: acc.outputTokens + (message.usage.output ?? 0),
            cost: acc.cost + (message.usage.cost?.total ?? 0),
          };
        },
        { turns: 0, inputTokens: 0, outputTokens: 0, cost: 0 }
      );

      const failed = aborted || last?.stopReason === 'error';
      const resultText = last
        ? last.content
            .filter((block) => block.type === 'text')
            .map((block) => block.text)
            .join('\n')
        : '';
      await settingsManager.flush().catch(() => undefined);
      session.dispose();

      return report({
        status: aborted ? 'interrupted' : last?.stopReason === 'error' ? 'error' : 'success',
        result: failed ? null : truncateResult(resultText),
        error: aborted
          ? '子 Agent 已被停止'
          : last?.stopReason === 'error'
            ? (last.errorMessage ?? '子 Agent 运行失败')
            : null,
        usage: usage.turns > 0 ? usage : null,
        activity: null,
        endedAt: Date.now(),
      });
    },
  };
}

/** @param text - 子 Agent 结果文本 @returns 超长截断后的文本 */
function truncateResult(text: string): string {
  if (text.length <= RESULT_TEXT_LIMIT) return text;
  return `${text.slice(0, RESULT_TEXT_LIMIT)}\n\n[结果超过 ${RESULT_TEXT_LIMIT} 字符,已截断]`;
}
