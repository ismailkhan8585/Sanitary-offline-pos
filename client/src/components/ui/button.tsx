import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
        accent: 'bg-accent text-accent-foreground hover:bg-accent/90 shadow-sm',
        success: 'bg-success text-white hover:bg-success/90 shadow-sm',
        destructive: 'bg-danger text-white hover:bg-danger/90 shadow-sm',
        outline: 'border border-border bg-surface hover:bg-surface-2',
        ghost: 'hover:bg-surface-2',
      },
      size: {
        default: 'h-11 px-4 text-base',
        sm: 'h-10 px-3 text-sm',
        lg: 'h-14 px-6 text-lg',
        xl: 'h-16 px-6 text-xl',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Keyboard shortcut shown on the button, e.g. "F9". */
  shortcut?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, shortcut, children, type = 'button', ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} type={asChild ? undefined : type} className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {asChild ? (
          children
        ) : (
          <>
            {children}
            {shortcut && <kbd className="num rounded bg-black/15 px-1.5 py-0.5 text-xs font-medium">{shortcut}</kbd>}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = 'Button';
