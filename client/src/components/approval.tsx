import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import type { TranslationKey } from '@/i18n/en';
import { PinPad } from './pin-pad';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

interface Request {
  reasons: { action: string; details?: { items?: (string | { name: string })[] } }[];
  error?: string;
}

type Ask = (req: Request) => Promise<string | null>;
const ApprovalContext = createContext<Ask | null>(null);

/** Shows the Admin PIN dialog on top of whatever screen asked for approval. */
export function ApprovalProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [request, setRequest] = useState<Request | null>(null);
  const [pin, setPin] = useState('');
  const resolver = useRef<((pin: string | null) => void) | null>(null);

  const ask = useCallback<Ask>((req) => {
    setPin('');
    setRequest(req);
    return new Promise((resolve) => (resolver.current = resolve));
  }, []);

  const finish = (value: string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setRequest(null);
  };

  return (
    <ApprovalContext.Provider value={ask}>
      {children}
      {request && (
        <Dialog
          open
          onOpenChange={(o) => !o && finish(null)}
          title={
            <span className="flex items-center gap-2 text-warning">
              <ShieldAlert /> {t('approval.title')}
            </span>
          }
        >
          <div className="space-y-4">
            <ul className="space-y-1 rounded-lg bg-warning/10 p-3">
              {request.reasons.map((r) => (
                <li key={r.action} className="font-semibold">
                  • {t(`approval.${r.action}` as TranslationKey)}
                  {r.details?.items && (
                    <span className="block ps-4 text-sm font-normal text-muted">
                      {r.details.items.map((i) => (typeof i === 'string' ? i : i.name)).join(', ')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p className="text-muted">{t('approval.help')}</p>
            {request.error && <p className="font-semibold text-danger">{request.error}</p>}
            <PinPad value={pin} onChange={setPin} onSubmit={() => finish(pin)} />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="lg" onClick={() => finish(null)}>
                {t('common.cancel')}
              </Button>
              <Button size="lg" disabled={pin.length < 4} onClick={() => finish(pin)}>
                {t('approval.approve')}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </ApprovalContext.Provider>
  );
}

/**
 * Wraps an API call that may need Admin approval: on APPROVAL_REQUIRED it asks for the
 * Admin PIN and calls again with it (re-asking after a wrong PIN).
 */
export function useWithApproval() {
  const ask = useContext(ApprovalContext);
  const { errorText } = useI18n();
  if (!ask) throw new Error('useWithApproval outside ApprovalProvider');
  return async <T,>(call: (adminPin?: string) => Promise<T>): Promise<T> => {
    try {
      return await call(undefined);
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 'APPROVAL_REQUIRED') throw e;
      const reasons = (e.params.details as Request['reasons']) ?? [];
      let error: string | undefined;
      for (;;) {
        const pin = await ask({ reasons, error });
        if (!pin) throw new ApiError(0, 'APPROVAL_CANCELLED', 'Not approved');
        try {
          return await call(pin);
        } catch (e2) {
          if (e2 instanceof ApiError && e2.code === 'WRONG_ADMIN_PIN') {
            error = errorText(e2);
            continue;
          }
          throw e2;
        }
      }
    }
  };
}
