'use client';

import Link from 'next/link';
import { Folder } from 'lucide-react';
import { useCategories } from '@/hooks/useCategories';
import { LoadingTransition } from '@/components/LoadingComponents';
import { encodeSlug } from '@/lib/slug';
import { CategoryIcon } from '@/components/CategoryIcon';

export default function CategoriesPage() {
  const { categories, loading, error } = useCategories();

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
        {Array.from({ length: 8 }).map((_, i) => (
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
      <div className="mb-8 fade-in-up">
        <h1 className="mb-4 inline-flex items-center gap-2 text-2xl font-bold">
          <Folder className="h-6 w-6" strokeWidth={1.8} aria-hidden="true" />
          <span>分类</span>
        </h1>
        <p className="text-muted-foreground">
          $ ls ./categories
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
        {categories.map(({ category, count }) => (
          <Link
            key={category}
            href={`/categories/${encodeSlug(category)}` as any}
            className="card no-link-underline p-4 transition-all duration-200 group hover:border-neutral-400 hover:bg-neutral-50 dark:hover:border-neutral-600 dark:hover:bg-neutral-800"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2 bg-neutral-100 rounded group-hover:bg-neutral-200 transition-colors dark:bg-neutral-800 dark:group-hover:bg-neutral-700">
                  <CategoryIcon
                    category={category}
                    className="h-5 w-5 text-neutral-600 transition-colors group-hover:text-neutral-900 dark:text-neutral-400 dark:group-hover:text-neutral-100"
                  />
                </div>
                <div>
                  <h3 className="font-semibold text-base group-hover:text-neutral-700 dark:group-hover:text-neutral-200 transition-colors">
                    {category}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    cd ./{category}
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
    </div>
  );

  return (
    <LoadingTransition loading={loading} skeleton={skeletonContent} delay={300}>
      {actualContent}
    </LoadingTransition>
  );
}
