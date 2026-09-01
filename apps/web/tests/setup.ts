import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom 未实现 scrollIntoView,聊天页滚动到底部依赖它
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom 未实现 matchMedia,响应式断点依赖它;默认匹配宽屏,保持既有测试行为不变
if (!window.matchMedia) {
  window.matchMedia = ((query: string) =>
    ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
}

// jsdom 未实现 ResizeObserver,可调整面板挂载时依赖浏览器提供该接口
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    disconnect(): void {}

    observe(): void {}

    unobserve(): void {}
  };
}

// jsdom 中所有元素矩形都是零,否则面板库会把任意点击误判为分隔条拖动
const getBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
HTMLElement.prototype.getBoundingClientRect = function getTestBoundingClientRect(): DOMRect {
  if (this.getAttribute('role') === 'separator') {
    return DOMRect.fromRect({ x: 256, y: 0, width: 1, height: 768 });
  }
  return getBoundingClientRect.call(this);
};

afterEach(() => {
  cleanup();
});
