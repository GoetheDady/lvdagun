import { Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * 应用根组件,渲染主界面。
 *
 * @returns 根组件元素
 */
function App(): React.JSX.Element {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <Button>
        <Plus />
        新建
      </Button>
    </main>
  );
}

export default App;
