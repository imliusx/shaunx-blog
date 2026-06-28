'use client';

import { usePathname } from 'next/navigation';
import { Terminal } from 'lucide-react';
import { useConfig } from '@/hooks/useConfig';

export function Footer() {
  const pathname = usePathname();
  const { data: config, loading } = useConfig();
  const currentYear = new Date().getFullYear();
  const yearRange = `2020-${currentYear}`;

  if (loading || !config) return null;

  const isAdminLoginPage = pathname === `/${config.secureEntrance}`;
  const isAdminPage = pathname.startsWith('/admin');

  if (isAdminLoginPage || isAdminPage) return null;

  return (
    <footer className="h-16 border-t border-neutral-200 bg-neutral-50/80 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/80">
      <div className="content-wrapper flex h-full flex-col items-start justify-center gap-0.5 text-xs text-neutral-500 dark:text-neutral-500 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="inline-flex min-w-0 items-center gap-2">
          <Terminal className="h-4 w-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
          <span className="truncate">
            $ echo &quot;{yearRange} {config.author.name}&quot;
          </span>
        </div>

        <div className="inline-flex min-w-0 items-center gap-2 sm:justify-end">
          <span className="text-neutral-400 dark:text-neutral-600" aria-hidden="true">
            {'//'}
          </span>
          <span className="truncate">created by {config.author.name}</span>
        </div>
      </div>
    </footer>
  );
}
