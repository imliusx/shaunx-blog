'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import { PostCard } from '@/components/PostCard';
import { Pagination } from '@/components/Pagination';
import { usePosts } from '@/hooks/usePosts';
import { useConfig } from '@/hooks/useConfig';
import { useRouter, useSearchParams } from 'next/navigation';
import { LoadingTransition } from '@/components/LoadingComponents';
import { FileCode2, Search, X } from 'lucide-react';

function PostsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentPage = Number(searchParams.get('page')) || 1;
  const searchQuery = searchParams.get('search')?.trim() || '';
  const [searchValue, setSearchValue] = useState(searchQuery);
  
  const { data: config } = useConfig();
  const postsPerPage = config?.postsPerPage || 6;
  
  const { posts, pagination, loading, error } = usePosts({
    page: currentPage,
    limit: postsPerPage,
    search: searchQuery,
    paginated: true
  });

  useEffect(() => {
    setSearchValue(searchQuery);
  }, [searchQuery]);

  const updateSearch = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const trimmedValue = value.trim();

    params.delete('page');

    if (trimmedValue) {
      params.set('search', trimmedValue);
    } else {
      params.delete('search');
    }

    const queryString = params.toString();
    router.push(queryString ? `/posts?${queryString}` : '/posts');
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

      <div className="space-y-6">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card p-6 card-loading min-h-[200px]">
            <div className="space-y-4">
              <div className="h-6 w-2/3 shimmer rounded"></div>
              <div className="h-4 w-full shimmer rounded"></div>
              <div className="h-4 w-5/6 shimmer rounded"></div>
              <div className="flex space-x-2 pt-2">
                <div className="h-6 w-16 shimmer rounded"></div>
                <div className="h-6 w-20 shimmer rounded"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const actualContent = (
    <div className="content-wrapper py-12">
      <div className="mb-8 flex flex-col gap-4 fade-in-up sm:flex-row sm:items-center sm:justify-between">
        <h1 className="inline-flex items-center gap-2 text-2xl font-bold">
          <FileCode2 className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
          <span>所有文章</span>
        </h1>

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
            placeholder="$ grep posts"
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

      {posts.length > 0 ? (
        <>
          <div className="space-y-6 stagger-children">
            {posts.map((post) => (
              <PostCard key={post.slug} post={post} />
            ))}
          </div>
          
          {pagination && pagination.totalPages > 1 && (
            <div className="fade-in-delayed">
              <Pagination
                pagination={pagination}
                basePath={
                  searchQuery
                    ? `/posts?search=${encodeURIComponent(searchQuery)}`
                    : '/posts'
                }
              />
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-16 fade-in">
          <h2 className="text-2xl font-semibold mb-4">
            {searchQuery ? '未找到文章' : '暂无文章'}
          </h2>
          <p className="text-muted-foreground">
            {searchQuery
              ? `没有匹配「${searchQuery}」的文章。`
              : '还没有发布任何文章，请稍后再来查看。'}
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

export default function PostsPage() {
  return (
    <Suspense fallback={
      <div className="content-wrapper py-12">
        <div className="mb-8">
          <div className="h-8 w-32 shimmer rounded mb-4"></div>
          <div className="h-4 w-48 shimmer rounded"></div>
        </div>
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card p-6 card-loading min-h-[200px]">
              <div className="space-y-4">
                <div className="h-6 w-2/3 shimmer rounded"></div>
                <div className="h-4 w-full shimmer rounded"></div>
                <div className="h-4 w-5/6 shimmer rounded"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    }>
      <PostsPageContent />
    </Suspense>
  );
}
