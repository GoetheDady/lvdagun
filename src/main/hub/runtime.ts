/**
 * @file Hub 的模型运行时(懒加载单例)。
 *
 * ModelRuntime 创建成本不低(恢复本地缓存的模型目录),且向导流程并不需要它,
 * 所以按"懒创建"决策:首次调用 getModelRuntime() 时才初始化,之后复用同一个实例。
 */
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

let runtimePromise: Promise<ModelRuntime> | null = null;

/**
 * 获取(或创建)共享的 ModelRuntime。
 *
 * @returns ModelRuntime 实例
 */
export function getModelRuntime(): Promise<ModelRuntime> {
  // 缓存 Promise 而非实例:并发首调时也只初始化一次
  runtimePromise ??= ModelRuntime.create();
  return runtimePromise;
}
