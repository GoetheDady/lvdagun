/** 草稿页与聊天页共用的输入区视觉常量与示例提示,保证两处形态一致。 */

/** 空会话中可直接填入输入框的示例提示。 */
export const SUGGESTIONS = ['总结今天的重要新闻', '帮我检查一个本地项目', '制定本周待办计划'];

/** 输入区容器:未聚焦时收窄,聚焦后展宽。 */
export const COMPOSER_GROUP_CLASS =
  'group/composer relative mx-auto max-w-xl rounded-xl border border-input bg-card shadow-sm transition-[max-width] duration-200 ease-out focus-within:max-w-3xl focus-within:border-primary/50 focus-within:ring-4 focus-within:ring-primary/10 motion-reduce:transition-none';

/** 输入框:未聚焦单行,聚焦后随工具行展开。 */
export const COMPOSER_TEXTAREA_CLASS =
  'block max-h-40 min-h-11 w-full resize-none bg-transparent px-3 py-3 pr-12 text-sm leading-5 transition-[min-height] duration-200 ease-out placeholder:text-muted-foreground focus-visible:outline-none group-focus-within/composer:min-h-20 motion-reduce:transition-none';

/** 工具行:未聚焦时收起,聚焦后展开显示模型等控件。 */
export const COMPOSER_TOOL_ROW_CLASS =
  'invisible flex max-h-0 min-h-0 items-center justify-end gap-1 overflow-hidden px-2 pb-0 pr-14 opacity-0 transition-[max-height,opacity,visibility,padding] duration-200 ease-out group-focus-within/composer:visible group-focus-within/composer:max-h-14 group-focus-within/composer:min-h-11 group-focus-within/composer:pb-2 group-focus-within/composer:opacity-100 motion-reduce:transition-none';

/**
 * 发送/停止按钮在输入区内的定位:收起时贴在单行右侧居中,
 * 聚焦展开后随容器增高落到右下角,位置变化走同一过渡。
 */
export const COMPOSER_BUTTON_CLASS =
  'absolute right-1 bottom-1 rounded-lg transition-all duration-200 ease-out group-focus-within/composer:right-2 group-focus-within/composer:bottom-2 motion-reduce:transition-none';
