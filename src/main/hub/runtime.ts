/**
 * @file Hub 的模型运行时(懒加载单例)。
 *
 * ModelRuntime 创建成本不低(恢复本地缓存的模型目录),且向导流程并不需要它,
 * 所以按"懒创建"决策:首次调用 getModelRuntime() 时才初始化,之后复用同一个实例。
 *
 * 隔离性:Pi 默认读 ~/.pi/agent 的 auth.json / models.json / models-store.json,
 * 本项目与 Pi 全局配置无关——凭证全部走我们自己的 config.json(InMemoryCredentialStore 不落盘),
 * 目录缓存与自定义模型文件指向 ~/.lvdagun(文件不存在 = 只用 SDK 内置 provider)。
 */
import { join } from 'node:path';

import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { DATA_DIR } from './config';

let runtimePromise: Promise<ModelRuntime> | null = null;

/**
 * 获取(或创建)共享的 ModelRuntime。
 *
 * @returns ModelRuntime 实例
 */
export function getModelRuntime(): Promise<ModelRuntime> {
  // 缓存 Promise 而非实例:并发首调时也只初始化一次
  runtimePromise ??= ModelRuntime.create({
    // 凭证只存内存:持久化凭证的唯一来源是本项目的 config.json
    credentials: new InMemoryCredentialStore(),
    // 自定义模型与目录缓存放自己的数据目录,不读 ~/.pi/agent
    modelsPath: join(DATA_DIR, 'models.json'),
    modelsStorePath: join(DATA_DIR, 'models-store.json'),
  });
  return runtimePromise;
}
