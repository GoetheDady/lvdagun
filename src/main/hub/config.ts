/**
 * @file Hub 配置:模型与凭证的本机文件存储。
 *
 * 设计决策见 docs/adr/0001-config-directory.md:数据放 ~/.lvdagun/(而非 Electron userData),
 * V2 内核独立后整个目录随内核走。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ModelConfig } from '../../shared/ipc';

/** 配置存取契约;当前唯一实现是 FileConfigStore */
export interface ConfigStore {
  /** 读取配置;未配置或配置损坏返回 null */
  load(): Promise<ModelConfig | null>;

  /** 写入配置(原子覆盖) */
  save(config: ModelConfig): Promise<void>;
}

/** 应用数据根目录(所有持久化数据都在此目录下) */
export const DATA_DIR = join(homedir(), '.lvdagun');
/** 模型配置文件路径 */
export const CONFIG_FILE = join(DATA_DIR, 'config.json');

/** 目录权限 0700、文件权限 0600:仅本用户可读写,Key 不暴露给同机其他用户 */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * 确保数据目录存在(启动时调用,幂等)。
 */
export async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true, mode: DIR_MODE });
}

/**
 * 模型配置的文件实现。
 *
 * 写入用"临时文件 + rename":先写 config.json.tmp 再原子改名,
 * 断电/崩溃时不会留下半写文件(PRD 验收 8)。
 * 解析失败时把原文件备份为 config.json.corrupt-<时间戳> 后按未配置处理,
 * 不做字段级 migration(架构原则 1:无历史包袱)。
 */
export class FileConfigStore implements ConfigStore {
  async load(): Promise<ModelConfig | null> {
    let raw: string;
    try {
      raw = await readFile(CONFIG_FILE, 'utf8');
    } catch (error) {
      // 文件不存在 = 首次启动,返回 null 进入向导
      if (isNodeError(error) && error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      return parseModelConfig(parsed);
    } catch {
      // 解析失败:备份原文件(尽量保住用户的 Key),视为未配置
      try {
        await rename(CONFIG_FILE, `${CONFIG_FILE}.corrupt-${Date.now()}`);
      } catch {
        // 备份失败也不阻断启动:最坏情况是下次 save 覆盖
      }
      return null;
    }
  }

  async save(config: ModelConfig): Promise<void> {
    await ensureDataDir();
    const tmpFile = `${CONFIG_FILE}.tmp`;
    await writeFile(tmpFile, `${JSON.stringify(config, null, 2)}\n`, { mode: FILE_MODE });
    await rename(tmpFile, CONFIG_FILE);
  }
}

/**
 * 校验并规整解析出的 JSON。
 *
 * 已配置判定:provider 与 modelId 为非空字符串;apiKey 必须是字符串(可为空)。
 * 不满足即抛出,由调用方按损坏处理。
 *
 * @param value - JSON.parse 结果
 * @returns 规整后的 ModelConfig
 * @throws 字段缺失或类型不符
 */
function parseModelConfig(value: unknown): ModelConfig {
  if (typeof value !== 'object' || value === null) {
    throw new Error('配置必须是对象');
  }
  const record = value as Record<string, unknown>;
  const { provider, modelId, apiKey } = record;
  if (typeof provider !== 'string' || provider.trim() === '') {
    throw new Error('provider 必须是非空字符串');
  }
  if (typeof modelId !== 'string' || modelId.trim() === '') {
    throw new Error('modelId 必须是非空字符串');
  }
  if (typeof apiKey !== 'string') {
    throw new Error('apiKey 必须是字符串');
  }
  return { provider, modelId, apiKey };
}

/**
 * 判断是否为带 code 的 Node 错误对象。
 *
 * @param error - 未知错误
 * @returns 是否为 NodeJS.ErrnoException
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
