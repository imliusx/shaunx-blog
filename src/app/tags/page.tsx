'use client';

import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Hash, Search, X } from 'lucide-react';
import { useTags } from '@/hooks/useTags';
import { LoadingTransition } from '@/components/LoadingComponents';

function TagsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchQuery = searchParams.get('search')?.trim() || '';
  const [searchValue, setSearchValue] = useState(searchQuery);
  const { tags, loading, error } = useTags();

  useEffect(() => {
    setSearchValue(searchQuery);
  }, [searchQuery]);

  const filteredTags = useMemo(() => {
    if (!searchQuery) return tags;

    const searchLower = searchQuery.toLowerCase();
    return tags.filter(({ tag }) => tag.toLowerCase().includes(searchLower));
  }, [searchQuery, tags]);

  const updateSearch = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const trimmedValue = value.trim();

    if (trimmedValue) {
      params.set('search', trimmedValue);
    } else {
      params.delete('search');
    }

    const queryString = params.toString();
    router.push(queryString ? `/tags?${queryString}` : '/tags');
  };

  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateSearch(searchValue);
  };

  const handleClearSearch = () => {
    setSearchValue('');
    updateSearch('');
  };

  if (error) {
    return (
      <div className="content-wrapper py-12">
        <div className="text-center py-16 fade-in">
          <div className="text-red-500 dark:text-red-400">
            <h2 className="text-2xl font-semibold mb-4">加载失败</h2>
            <p>{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const skeletonContent = (
    <div className="content-wrapper py-12">
      <div className="mb-8">
        <div className="h-8 w-32 shimmer rounded mb-4"></div>
        <div className="h-4 w-48 shimmer rounded"></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="card p-4 card-loading min-h-[96px]">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 shimmer rounded"></div>
                <div className="space-y-2">
                  <div className="h-4 w-16 shimmer rounded"></div>
                  <div className="h-3 w-20 shimmer rounded"></div>
                </div>
              </div>
              <div className="h-5 w-5 shimmer rounded"></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const actualContent = (
    <div className="content-wrapper py-12">
      <div className="mb-8 flex flex-col gap-4 fade-in-up sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="mb-4 inline-flex items-center gap-2 text-2xl font-bold">
            <Hash className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
            <span>标签</span>
          </h1>
          <p className="text-muted-foreground">
            Browse articles by tags, total {tags.length} tags
          </p>
        </div>

        <form
          onSubmit={handleSearchSubmit}
          className="relative w-48 max-w-full sm:w-56"
          role="search"
        >
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
            strokeWidth={1.8}
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
            placeholder="$ grep tags"
            className="h-8 w-full border border-neutral-300 bg-transparent pl-9 pr-9 font-mono text-xs text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-900 dark:border-neutral-700 dark:text-neutral-100 dark:placeholder:text-neutral-600 dark:focus:border-neutral-400"
          />
          {searchValue && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="no-link-underline absolute right-3 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center text-neutral-500 transition-colors hover:text-neutral-900 dark:hover:text-neutral-100"
              aria-label="清空搜索"
            >
              <X className="h-4 w-4" strokeWidth={1.8} />
            </button>
          )}
        </form>
      </div>

      {filteredTags.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
          {filteredTags.map(({ tag, count }) => (
            <Link
              key={tag}
              href={`/tags/${encodeURIComponent(tag)}`}
              className="card no-link-underline p-4 transition-all duration-200 group hover:border-neutral-400 hover:bg-neutral-50 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="p-1.5 bg-neutral-100 rounded group-hover:bg-neutral-200 transition-colors dark:bg-neutral-800 dark:group-hover:bg-neutral-700">
                    <Hash className="h-4 w-4 text-neutral-600 transition-colors group-hover:text-neutral-900 dark:text-neutral-400 dark:group-hover:text-neutral-100" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base group-hover:text-neutral-700 dark:group-hover:text-neutral-200 transition-colors">
                      {tag}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {count} 篇文章
                    </p>
                  </div>
                </div>
                <div className="text-xl font-bold text-muted-foreground/50 transition-colors group-hover:text-neutral-700 dark:group-hover:text-neutral-300">
                  {count}
                </div>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center py-16 fade-in">
          <Hash className="h-16 w-16 text-muted-foreground/50 mx-auto mb-4" />
          <h2 className="text-2xl font-semibold mb-4">
            {searchQuery ? '未找到标签' : '暂无标签'}
          </h2>
          <p className="text-muted-foreground">
            {searchQuery
              ? `没有匹配「${searchQuery}」的标签。`
              : '还没有任何标签，发布文章后标签会在这里显示。'}
          </p>
        </div>
      )}
    </div>
  );

  return (
    <LoadingTransition
      loading={loading}
      skeleton={skeletonContent}
      delay={300}
    >
      {actualContent}
    </LoadingTransition>
  );
}

export default function TagsPage() {
  return (
    <Suspense fallback={
      <div className="content-wrapper py-12">
        <div className="mb-8">
          <div className="h-8 w-32 shimmer rounded mb-4"></div>
          <div className="h-4 w-48 shimmer rounded"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card p-4 card-loading min-h-[96px]" />
          ))}
        </div>
      </div>
    }>
      <TagsPageContent />
    </Suspense>
  );
}
