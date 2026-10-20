'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useRevealOnView } from './use-reveal';

/**
 * A block that reveals once, when first scrolled into view (the roadmap
 * cards staggering in). It only sets `data-state`; the
 * motion itself is CSS ("/about motion" in globals.css), which resolves the
 * server's `pending` to the finished picture under reduced motion or with no
 * script, so a static render shows everything.
 */
export function Reveal({
  name,
  className,
  style,
  children,
}: {
  name: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const { ref, reduced, started } = useRevealOnView<HTMLDivElement>(0.2);
  return (
    <div
      ref={ref}
      data-reveal={name}
      data-state={reduced || started ? 'done' : 'pending'}
      className={className}
      style={style}
    >
      {children}
    </div>
  );
}
