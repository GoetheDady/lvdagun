import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type {
  AssistantSegmentStatus,
  ProductAssistantBlock,
  ProductAssistantSegmentItem,
  ProductToolResultItem,
} from '@lvdagun/protocol';

/** @param message - Pi 消息 @returns 用户纯文本；非用户消息返回空字符串 */
export function readPiUserText(message: AgentMessage): string {
  if (message.role !== 'user') return '';
  if (typeof message.content === 'string') return message.content;
  return message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

/**
 * 把 Pi 助手消息映射为产品片段。
 *
 * @param message - Pi 助手消息
 * @param identity - 产品条目标识与所属运行
 * @param status - 产品片段状态
 * @param resolveToolCallId - 把 Pi 工具调用标识映射为产品标识
 * @returns 不含 Pi 类型的产品片段
 */
export function mapPiAssistantSegment(
  message: Extract<AgentMessage, { role: 'assistant' }>,
  identity: { itemId: string; runId: string },
  status: AssistantSegmentStatus,
  resolveToolCallId: (piToolCallId: string) => string
): ProductAssistantSegmentItem {
  const content: ProductAssistantBlock[] = message.content.map((block) => {
    if (block.type === 'text') return { type: 'text', text: block.text };
    if (block.type === 'thinking') {
      return { type: 'thinking', text: block.thinking, redacted: block.redacted };
    }
    return {
      type: 'tool_call',
      toolCallId: resolveToolCallId(block.id),
      toolName: block.name,
      args: block.arguments,
    };
  });
  return {
    type: 'assistant_segment',
    ...identity,
    createdAt: message.timestamp,
    status,
    content,
    ...(message.errorMessage ? { errorMessage: message.errorMessage } : {}),
  };
}

/**
 * 把 Pi 工具结果映射为产品条目，并把图片交给 BLOB 仓储。
 *
 * @param message - Pi 工具结果消息
 * @param identity - 产品条目标识与所属运行
 * @param args - 对应工具调用参数
 * @param toolCallId - 产品工具调用标识
 * @param storeBlob - 图片 BLOB 写入函数
 * @returns 不含 Base64 图片的产品工具结果
 */
export function mapPiToolResult(
  message: Extract<AgentMessage, { role: 'toolResult' }>,
  identity: { itemId: string; runId: string },
  args: unknown,
  toolCallId: string,
  storeBlob: (mimeType: string, data: Uint8Array) => string
): ProductToolResultItem {
  return {
    type: 'tool_result',
    ...identity,
    createdAt: message.timestamp,
    toolCallId,
    toolName: message.toolName,
    args,
    content: message.content.map((block) =>
      block.type === 'text'
        ? { type: 'text', text: block.text }
        : {
            type: 'image',
            mimeType: block.mimeType,
            blobId: storeBlob(block.mimeType, Buffer.from(block.data, 'base64')),
          }
    ),
    isError: message.isError,
  };
}

/** @param message - Pi 助手消息 @returns 对应产品完成状态 */
export function mapPiAssistantStatus(
  message: Extract<AgentMessage, { role: 'assistant' }>
): AssistantSegmentStatus {
  if (message.stopReason === 'error') return 'failed';
  if (message.stopReason === 'aborted') return 'aborted';
  return 'completed';
}
