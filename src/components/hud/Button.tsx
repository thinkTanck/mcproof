import type { ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * HUD button. The global `:focus-visible` ring (globals.css) paints the focus
 * outline, so no variant removes it. primary = cyan line + faint fill, and the
 * accent glow while the pointer or the keyboard is on it (`glow-accent`, never
 * at rest and never disabled); ghost = line only; destructive = red line.
 */
const button = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-md font-mono tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'border border-nominal bg-nominal/10 text-readout glow-accent hover:bg-nominal/20',
        ghost:
          'border border-line-em bg-transparent text-nominal hover:border-nominal hover:bg-nominal/10',
        destructive: 'border border-breach bg-breach/10 text-breach-text hover:bg-breach/20',
      },
      size: {
        md: 'px-5 py-3 text-[14px]',
        sm: 'px-4 py-2 text-xs',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>;

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(button({ variant, size }), className)} {...props} />;
}
