import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/**
 * 获取或首次生成本机访问 token。
 *
 * @param dir - 应用数据目录
 * @returns 32 字节随机 token（64 位十六进制）
 */
export async function getOrCreateToken(dir: string): Promise<string> {
  const file = join(dir, 'token');
  try {
    const existing = (await readFile(file, 'utf8')).trim();
    if (existing.length > 0) {
      return existing;
    }
  } catch {
    // 文件不存在或不可读时生成新 token。
  }
  await mkdir(dir, { recursive: true, mode: DIR_MODE });
  const token = randomBytes(32).toString('hex');
  await writeFile(file, token, { mode: FILE_MODE });
  return token;
}
