import Link from 'next/link';
import { Hash } from 'lucide-react';

interface TagListProps {
  tags: string[];
  showIcon?: boolean;
  linkable?: boolean;
  wrap?: boolean;
  className?: string;
}

export function TagList({
  tags,
  showIcon = false,
  linkable = false,
  wrap = true,
  className = '',
}: TagListProps) {
  if (tags.length === 0) return null;

  return (
    <div className={`flex gap-2 ${wrap ? 'flex-wrap' : 'flex-nowrap'} ${className}`}>
      {showIcon && <Hash className="h-4 w-4 text-neutral-500 mt-0.5" />}
      {tags.map((tag) => (
        linkable ? (
          <Link
            key={tag}
            href={`/tags/${encodeURIComponent(tag)}`}
            className="no-link-underline inline-flex shrink-0 items-center rounded-md bg-neutral-100 dark:bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
          >
            {tag}
          </Link>
        ) : (
          <span
            key={tag}
            className="inline-flex shrink-0 items-center rounded-md bg-neutral-100 dark:bg-neutral-800 px-3 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-300"
          >
            {tag}
          </span>
        )
      ))}
    </div>
  );
}
