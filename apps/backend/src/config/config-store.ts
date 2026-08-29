/**
 * @file 模型服务配置的本机文件存储。
 *
 * 设计决策见 docs/adr/0001-config-directory.md。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { ModelSettings } from '@lvdagun/protocol';

import { parseModelSettings } from './model-settings';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** 配置存取契约 */
export interface ConfigStore {
  /**
   * 读取模型服务配置。
   *
   * @returns 模型服务配置；未配置或配置损坏时 providers 为空数组
   */
  load(): Promise<ModelSettings>;

  /**
   * 原子写入模型服务配置。
   *
   * @param settings - 要持久化的模型服务配置
   * @returns 写入完成后解决的 Promise
   */
  save(settings: ModelSettings): Promise<void>;
}

/** 模型服务配置的文件存储实现 */
export class FileConfigStore implements ConfigStore {
  private readonly file: string;

  /**
   * 创建模型服务配置存储。
   *
   * @param file - 配置文件完整路径
   */
  constructor(file: string) {
    this.file = file;
  }

  /**
   * 读取并校验模型服务配置。
   *
   * @returns 模型服务配置；文件不存在或损坏时 providers 为空数组
   * @throws 文件读取失败（非不存在）
   */
  async load(): Promise<ModelSettings> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return { providers: [], defaultModel: null };
      }
      throw error;
    }

    try {
      return parseModelSettings(JSON.parse(raw));
    } catch {
      // 配置损坏时尽量保留用户凭证，备份失败也不阻断首次配置流程。
      try {
        await rename(this.file, `${this.file}.corrupt-${Date.now()}`);
      } catch {
        // 下次保存配置时会覆盖原文件。
      }
      return { providers: [], defaultModel: null };
    }
  }

  /**
   * 使用临时文件和原子改名写入模型服务配置。
   *
   * @param settings - 要持久化的模型服务配置
   * @returns 写入完成后解决的 Promise
   */
  async save(settings: ModelSettings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: DIR_MODE });
    const tmpFile = `${this.file}.tmp`;
    await writeFile(tmpFile, `${JSON.stringify(settings, null, 2)}\n`, { mode: FILE_MODE });
    await rename(tmpFile, this.file);
  }
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
