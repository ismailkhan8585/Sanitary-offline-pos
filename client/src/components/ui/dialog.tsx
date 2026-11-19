import type { ReactNode } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

const overlay = 'fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0';

/** Centered dialog for short tasks (pay, PIN approval, confirmations). */
export function Dialog({ open, onOpenChange, title, children, footer, className }: BaseProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlay} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex max-h-[95vh] w-[95vw] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-border bg-surface shadow-xl data-[state=open]:animate-in data-[state=open]:zoom-in-95',
            className,
          )}
        >
          <Header title={title} />
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border p-4">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Right-side drawer for add/edit forms (left side in Urdu/RTL). */
export function Sheet({ open, onOpenChange, title, children, footer, className }: BaseProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={overlay} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            'fixed inset-y-0 end-0 z-50 flex w-full max-w-xl flex-col border-s border-border bg-surface shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-right rtl:data-[state=open]:slide-in-from-left',
            className,
          )}
        >
          <Header title={title} />
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-border p-4">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Header({ title }: { title: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-5 py-3">
      <DialogPrimitive.Title className="text-xl font-bold">{title}</DialogPrimitive.Title>
      <DialogPrimitive.Close className="rounded-md p-2.5 text-muted hover:bg-surface-2" aria-label="Close">
        <X className="size-5" />
      </DialogPrimitive.Close>
    </div>
  );
}
