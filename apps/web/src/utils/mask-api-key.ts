/**
 * API Key 掩码:只露前 5 位与后 4 位,防止整 Key 显示(PRD 6.1 掩码显示)。
 *
 * @param key - 完整 Key
 * @returns 掩码后的展示串;空 Key 返回"未设置"
 */
export function maskKey(key: string): string {
  if (key === '') {
    return '未设置';
  }
  if (key.length <= 8) {
    return '****';
  }
  return `${key.slice(0, 5)}****${key.slice(-4)}`;
}
