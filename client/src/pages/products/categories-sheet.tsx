import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useCategories } from '@/hooks/use-products';
import type { Category } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet } from '@/components/ui/dialog';

export function CategoriesSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const categories = useCategories();
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={t('products.categories')}>
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-sm font-semibold text-muted">
          <span>{t('products.nameEn')}</span>
          <span>{t('products.nameUr')}</span>
          <span className="w-11" />
        </div>
        {categories.data?.map((c) => <CategoryRow key={c.id} category={c} />)}
        <CategoryRow category={null} />
      </div>
    </Sheet>
  );
}

function CategoryRow({ category }: { category: Category | null }) {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const [nameEn, setNameEn] = useState(category?.nameEn ?? '');
  const [nameUr, setNameUr] = useState(category?.nameUr ?? '');
  const dirty = nameEn.trim() !== (category?.nameEn ?? '') || nameUr.trim() !== (category?.nameUr ?? '');
  const save = useMutation({
    mutationFn: () => (category ? api(`/categories/${category.id}`, 'PUT', { nameEn, nameUr }) : api('/categories', 'POST', { nameEn, nameUr })),
    onSuccess: () => {
      toast.success(t('common.saved'));
      if (!category) {
        setNameEn('');
        setNameUr('');
      }
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return (
    <form
      className="grid grid-cols-[1fr_1fr_auto] gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (nameEn.trim() && dirty) save.mutate();
      }}
    >
      <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder={category ? '' : t('products.categoryAdd')} />
      <Input value={nameUr} onChange={(e) => setNameUr(e.target.value)} dir="rtl" className="font-urdu" />
      <Button type="submit" size="icon" variant={category ? 'outline' : 'default'} disabled={!nameEn.trim() || !dirty || save.isPending} aria-label={t('common.save')}>
        {category ? '✓' : <Plus />}
      </Button>
    </form>
  );
}
