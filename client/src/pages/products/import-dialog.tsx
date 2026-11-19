import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Upload } from 'lucide-react';
import { api, downloadUrl } from '@/lib/api';
import { useI18n } from '@/i18n';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';

interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api<ImportResult>('/products/import', 'POST', fd);
    },
    onSuccess: (r) => {
      setResult(r);
      toast.success(t('products.importResult', { created: r.created, updated: r.updated }));
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('products.import')} footer={<Button variant="outline" onClick={onClose}>{t('common.close')}</Button>}>
      <div className="space-y-4">
        <p className="text-muted">{t('products.importHelp')}</p>
        <Button variant="outline" asChild className="w-full">
          <a href={downloadUrl('/products/template.xlsx')} download>
            <Download /> {t('products.template')}
          </a>
        </Button>
        <input
          ref={input}
          type="file"
          accept=".xlsx"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
            e.target.value = '';
          }}
        />
        <Button size="lg" className="w-full" disabled={upload.isPending} onClick={() => input.current?.click()}>
          <Upload /> {upload.isPending ? t('common.loading') : t('products.importChoose')}
        </Button>
        {result && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="font-semibold text-success">{t('products.importResult', { created: result.created, updated: result.updated })}</p>
            {result.errors.length > 0 && (
              <>
                <p className="font-semibold text-danger">{t('products.importErrors', { count: result.errors.length })}</p>
                <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
                  {result.errors.map((e) => (
                    <li key={e.row}>
                      <span className="num font-semibold">{t('products.row', { row: e.row })}</span>: {e.message}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
