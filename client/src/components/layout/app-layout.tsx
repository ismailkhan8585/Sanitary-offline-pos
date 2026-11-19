import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { ChevronsLeft, Languages, Lock, Moon, Sun } from 'lucide-react';
import { useI18n } from '@/i18n';
import { navItems } from '@/nav';
import { cn } from '@/lib/utils';
import { setSession, useSession } from '@/lib/session';
import { useCan, useMe, usePublicSettings } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { useRealtime } from '@/lib/realtime';
import { Button } from '@/components/ui/button';

export function AppLayout() {
  const { t } = useI18n();
  const can = useCan();
  const [collapsed, setCollapsed] = useState(false);
  const items = navItems.filter((i) => !i.perm || can(i.perm));

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className={cn('flex shrink-0 flex-col border-e border-border bg-surface transition-all', collapsed ? 'w-[72px]' : 'w-60')}>
        <div className="flex h-16 items-center gap-2 border-b border-border px-4">
          <img src="/icon.svg" alt="" className="size-9" />
          {!collapsed && <span className="text-lg font-bold text-primary">{t('app.name')}</span>}
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              title={t(item.label)}
              className={({ isActive }) =>
                cn(
                  'flex h-11 items-center gap-3 rounded-md px-3 font-semibold text-muted hover:bg-surface-2',
                  isActive && 'bg-primary text-primary-foreground hover:bg-primary/90',
                )
              }
            >
              <item.icon className="size-5 shrink-0" />
              {!collapsed && <span className="truncate">{t(item.label)}</span>}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex h-12 items-center gap-3 border-t border-border px-5 text-muted hover:bg-surface-2"
          title={t('nav.collapse')}
        >
          <ChevronsLeft className={cn('size-5 rtl-flip transition-transform', collapsed && 'rotate-180')} />
          {!collapsed && <span className="text-sm">{t('nav.collapse')}</span>}
        </button>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function TopBar() {
  const { t, lang, setLang } = useI18n();
  const session = useSession();
  const { data: me } = useMe();
  const { data: shop } = usePublicSettings();
  const { theme, toggle } = useTheme();
  const { connected: online } = useRealtime();

  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-bold">{lang === 'ur' && shop?.shop_name_ur ? shop.shop_name_ur : shop?.shop_name_en}</p>
      </div>
      <span className="hidden rounded-md bg-accent/15 px-3 py-1.5 text-sm font-bold sm:inline">
        {me?.device ? `${me.device.name} (${me.device.billPrefix})` : t('top.noCounter')}
      </span>
      <span className="hidden font-semibold md:inline">{session?.user.name}</span>
      <span
        className={cn('flex items-center gap-1.5 text-sm font-medium', online ? 'text-success' : 'text-danger')}
        title={`${t('top.server')}: ${online ? t('top.connected') : t('top.disconnected')}`}
      >
        <span className={cn('size-3 rounded-full', online ? 'bg-success' : 'bg-danger animate-pulse')} />
        <span className="hidden lg:inline">{online ? t('top.connected') : t('top.disconnected')}</span>
      </span>
      <Button variant="ghost" size="icon" onClick={toggle} title={t('top.theme')}>
        {theme === 'dark' ? <Sun /> : <Moon />}
      </Button>
      <Button variant="outline" onClick={() => setLang(lang === 'en' ? 'ur' : 'en')}>
        <Languages />
        {lang === 'en' ? 'اردو' : 'English'}
      </Button>
      <Button variant="outline" onClick={() => setSession(null)}>
        <Lock />
        <span className="hidden sm:inline">{t('top.lock')}</span>
      </Button>
    </header>
  );
}
