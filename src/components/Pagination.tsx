import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PaginationInfo } from '@/types';
import { cn } from '@/lib/utils';

interface PaginationProps {
  pagination: PaginationInfo;
  basePath?: string;
}

export function Pagination({ pagination, basePath = '/posts' }: PaginationProps) {
  const { currentPage, totalPages, hasNextPage, hasPrevPage } = pagination;

  if (totalPages <= 1) return null;

  const generatePageUrl = (page: number) => {
    if (page === 1) return basePath;
    const separator = basePath.includes('?') ? '&' : '?';
    return `${basePath}${separator}page=${page}`;
  };

  const getPageLinkClassName = (page: number) =>
    cn(
      'no-link-underline inline-flex h-9 min-w-9 items-center justify-center border px-3',
      'font-mono text-sm font-medium leading-none transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900',
      'focus-visible:ring-offset-2 dark:focus-visible:ring-neutral-100',
      currentPage === page
        ? 'border-neutral-900 bg-neutral-900 text-neutral-50 shadow-sm hover:text-neutral-50 dark:border-neutral-100 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:text-neutral-900'
        : 'border-transparent text-neutral-500 hover:border-neutral-300 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'
    );

  const renderPageNumbers = () => {
    const pages = [];
    const showPages = 5; // 显示的页码数量
    let startPage = Math.max(1, currentPage - Math.floor(showPages / 2));
    const endPage = Math.min(totalPages, startPage + showPages - 1);

    // 调整起始页码
    if (endPage - startPage + 1 < showPages) {
      startPage = Math.max(1, endPage - showPages + 1);
    }

    // 第一页
    if (startPage > 1) {
      pages.push(
        <Link
          key={1}
          href={generatePageUrl(1) as any}
          className={getPageLinkClassName(1)}
          aria-current={currentPage === 1 ? 'page' : undefined}
        >
          1
        </Link>
      );

      if (startPage > 2) {
        pages.push(
          <span
            key="ellipsis1"
            className="inline-flex h-9 min-w-6 items-center justify-center text-sm text-neutral-400 dark:text-neutral-600"
          >
            ...
          </span>
        );
      }
    }

    // 页码范围
    for (let i = startPage; i <= endPage; i++) {
      pages.push(
        <Link
          key={i}
          href={generatePageUrl(i) as any}
          className={getPageLinkClassName(i)}
          aria-current={currentPage === i ? 'page' : undefined}
        >
          {i}
        </Link>
      );
    }

    // 最后一页
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        pages.push(
          <span
            key="ellipsis2"
            className="inline-flex h-9 min-w-6 items-center justify-center text-sm text-neutral-400 dark:text-neutral-600"
          >
            ...
          </span>
        );
      }

      pages.push(
        <Link
          key={totalPages}
          href={generatePageUrl(totalPages) as any}
          className={getPageLinkClassName(totalPages)}
          aria-current={currentPage === totalPages ? 'page' : undefined}
        >
          {totalPages}
        </Link>
      );
    }

    return pages;
  };

  return (
    <nav
      className="mt-8 flex flex-wrap items-center justify-center gap-2"
      aria-label="文章列表分页"
    >
      <Link
        href={hasPrevPage ? generatePageUrl(currentPage - 1) as any : '#'}
        className={cn(
          'no-link-underline inline-flex h-9 items-center border border-transparent px-3 font-mono text-sm font-medium leading-none transition-colors',
          hasPrevPage
            ? 'text-neutral-500 hover:border-neutral-300 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'
            : 'cursor-not-allowed text-neutral-300 dark:text-neutral-700'
        )}
        aria-disabled={!hasPrevPage}
        {...(!hasPrevPage && { onClick: (e) => e.preventDefault() })}
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        上一页
      </Link>

      <div className="flex items-center gap-1 sm:mx-2">
        {renderPageNumbers()}
      </div>

      <Link
        href={hasNextPage ? generatePageUrl(currentPage + 1) as any : '#'}
        className={cn(
          'no-link-underline inline-flex h-9 items-center border border-transparent px-3 font-mono text-sm font-medium leading-none transition-colors',
          hasNextPage
            ? 'text-neutral-500 hover:border-neutral-300 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-100'
            : 'cursor-not-allowed text-neutral-300 dark:text-neutral-700'
        )}
        aria-disabled={!hasNextPage}
        {...(!hasNextPage && { onClick: (e) => e.preventDefault() })}
      >
        下一页
        <ChevronRight className="h-4 w-4 ml-1" />
      </Link>
    </nav>
  );
}
