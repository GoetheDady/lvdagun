import { NavLink, Outlet, useNavigate } from 'react-router';
import { ArrowLeft, Info, Server } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/** 设置分区导航项 */
const NAV_ITEMS = [
  { to: 'model', label: '模型服务', icon: Server },
  { to: 'about', label: '关于', icon: Info },
];

/**
 * 设置页布局:左侧分区导航,右侧当前分区详情(PRD 6.1)。
 *
 * @returns 设置页布局元素
 */
function SettingsPage(): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <main className="flex h-screen overflow-hidden bg-muted/40">
      <aside className="flex w-48 shrink-0 flex-col border-r bg-background p-3">
        <h1 className="font-display mb-4 px-3 text-xl font-bold tracking-wide">设置</h1>
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive
                    ? 'bg-primary/10 font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted'
                }`
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <Button
          variant="ghost"
          size="sm"
          className="mt-auto justify-start px-3 text-muted-foreground"
          onClick={() => navigate('/')}
        >
          <ArrowLeft />
          返回对话
        </Button>
      </aside>
      <section className="min-w-0 flex-1 overflow-y-auto p-6">
        <Outlet />
      </section>
    </main>
  );
}

/**
 * 关于分区:铺子的招牌——品牌名立在米黄匾额上,下方是产品与隐私说明。
 *
 * @returns 关于面板元素
 */
export function AboutPanel(): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div className="space-y-1.5">
        <h1 className="font-display text-2xl font-bold tracking-wide">关于</h1>
        <p className="text-sm text-muted-foreground">产品信息与隐私说明。</p>
      </div>
      <Card>
        <CardContent className="p-6">
          {/* 匾额:品牌名是铺子的门面,居中立在米黄匾上,与默认模型的招牌同材质 */}
          <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-secondary/60 px-6 py-8 text-center">
            <img
              alt=""
              className="size-12 rounded-md"
              height="48"
              src="/brand/logo-512.png"
              width="48"
            />
            <p className="font-display text-3xl font-bold tracking-wide">驴打滚</p>
          </div>
          <div className="mt-5 space-y-1 text-center text-sm">
            <p className="font-medium">V0 · 个人 AI 管家</p>
            <p className="text-muted-foreground">对话数据只存本机,由 lvdagun 命令管理服务。</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default SettingsPage;
