import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { api } from '@/services/api-client';

/**
 * 将首页解析到最近会话；首次使用时创建空会话。
 *
 * @returns 会话解析占位页
 */
function SessionIndexPage(): React.JSX.Element {
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    void (async () => {
      try {
        const sessions = await api.listSessions();
        const sessionId = sessions[0]?.id ?? (await api.createSession()).sessionId;
        navigate(`/sessions/${encodeURIComponent(sessionId)}`, { replace: true });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    })();
  }, [navigate]);

  return (
    <main className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
      {error ?? '正在加载会话...'}
    </main>
  );
}

export default SessionIndexPage;
