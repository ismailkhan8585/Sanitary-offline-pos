import { useEffect } from 'react';
import { Delete } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PinPadProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  maxLength?: number;
  disabled?: boolean;
}

/** Big touch number pad that also listens to the keyboard. */
export function PinPad({ value, onChange, onSubmit, maxLength = 8, disabled }: PinPadProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return;
      if (/^\d$/.test(e.key) && value.length < maxLength) onChange(value + e.key);
      else if (e.key === 'Backspace') onChange(value.slice(0, -1));
      else if (e.key === 'Enter' && value.length >= 4) onSubmit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [value, onChange, onSubmit, maxLength, disabled]);

  const key = 'h-16 rounded-lg border border-border bg-surface text-2xl font-semibold num hover:bg-surface-2 active:scale-95 transition';
  return (
    <div className="space-y-4">
      <div className="flex h-12 items-center justify-center gap-3" dir="ltr">
        {Array.from({ length: Math.max(4, value.length) }, (_, i) => (
          <span key={i} className={cn('size-4 rounded-full border-2 border-primary', i < value.length && 'bg-primary')} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3" dir="ltr">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} disabled={disabled} className={key} onClick={() => value.length < maxLength && onChange(value + d)}>
            {d}
          </button>
        ))}
        <button disabled={disabled} className={cn(key, 'text-base text-muted')} onClick={() => onChange('')}>
          C
        </button>
        <button disabled={disabled} className={key} onClick={() => value.length < maxLength && onChange(value + '0')}>
          0
        </button>
        <button disabled={disabled} className={cn(key, 'flex items-center justify-center')} onClick={() => onChange(value.slice(0, -1))} aria-label="Backspace">
          <Delete className="size-6" />
        </button>
      </div>
    </div>
  );
}
