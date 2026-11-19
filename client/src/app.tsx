import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import { I18nProvider, useI18n } from '@/i18n';
import { useSession } from '@/lib/session';
import { useCan } from '@/hooks/use-auth';
import { AppLayout } from '@/components/layout/app-layout';
import { ApprovalProvider } from '@/components/approval';
import { LoginPage } from '@/pages/login-page';
import { extraRoutes, navItems } from '@/nav';
import type { Permission } from '@shared/permissions';
import type { ReactNode } from 'react';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ApprovalProvider>
          <BrowserRouter>
            <Root />
          </BrowserRouter>
        </ApprovalProvider>
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
        {navItems.map((item) => (
          <Route key={item.to} path={item.to} element={item.perm ? <Guard perm={item.perm}>{item.element}</Guard> : item.element} />
        ))}
        {extraRoutes.map((r) => (
          <Route key={r.path} path={r.path} element={<Guard perm={r.perm}>{r.element}</Guard>} />
        ))}
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
