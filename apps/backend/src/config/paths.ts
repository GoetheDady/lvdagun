import { homedir } from 'node:os';
import { join } from 'node:path';

/** 应用数据根目录（所有持久化数据都在此目录下） */
export const DATA_DIR = join(homedir(), '.lvdagun');

/** 模型配置文件路径 */
export const CONFIG_FILE = join(DATA_DIR, 'config.json');
