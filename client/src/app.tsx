import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { I18nProvider, useI18n } from '@/i18n';
import { useSession } from '@/lib/session';
import { useCan } from '@/hooks/use-auth';
import { AppLayout } from '@/components/layout/app-layout';
import { LoginPage } from '@/pages/login-page';
import { SettingsPage } from '@/pages/settings/settings-page';
import { navItems } from '@/nav';
import type { Permission } from '@shared/permissions';
import type { ReactNode } from 'react';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <BrowserRouter>
          <Root />
        </BrowserRouter>
        <ToasterWithDir />
      </I18nProvider>
    </QueryClientProvider>
  );
}

function ToasterWithDir() {
  const { lang } = useI18n();
  return <Toaster richColors position="top-center" dir={lang === 'ur' ? 'rtl' : 'ltr'} toastOptions={{ className: 'text-base' }} />;
}

function Root() {
  const session = useSession();
  if (!session) return <LoginPage />;
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Home />} />
        <Route path="settings" element={<Guard perm="settings"><SettingsPage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

/** First screen after login: the first menu item this user may open. */
function Home() {
  const can = useCan();
  const first = navItems.find((i) => !i.perm || can(i.perm));
  return first ? <Navigate to={first.to} replace /> : null;
}

/** Blocks a page the user may not open (the server also refuses the data). */
function Guard({ perm, children }: { perm: Permission; children: ReactNode }) {
  const can = useCan();
  return can(perm) ? <>{children}</> : <Navigate to="/" replace />;
}
