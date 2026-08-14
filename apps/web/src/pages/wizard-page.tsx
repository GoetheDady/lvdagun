import { useNavigate } from 'react-router';

import { WizardCard } from '@/components/wizard/wizard-card';

/**
 * 配置向导页(仅首次访问出现):完成后进入对话页。
 *
 * @returns 向导页元素
 */
function WizardPage(): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <WizardCard
        onDone={() => {
          void navigate('/', { replace: true });
        }}
      />
    </main>
  );
}

export default WizardPage;
