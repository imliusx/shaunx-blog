'use client';

import Link from 'next/link';
import { CornerDownLeft } from 'lucide-react';
import { TypewriterTitle } from '@/components/TypewriterTitle';
import { useConfig } from '@/hooks/useConfig';
import { LoadingTransition } from '@/components/LoadingComponents';
import { POST_CATEGORIES } from '@/lib/categories';
import { encodeSlug } from '@/lib/slug';

export default function HomePage() {
  const { data: config, loading, error } = useConfig();
  const homeViewportClass = 'h-[calc(100svh-72px)] max-h-[calc(100svh-72px)] overflow-hidden md:h-[calc(100dvh-72px)] md:max-h-[calc(100dvh-72px)]';
  const homeContentClass = 'content-wrapper h-full max-h-full overflow-hidden';
  const homeSectionClass = 'flex h-full min-h-0 flex-col items-center justify-center overflow-hidden py-4 text-center md:py-8';

  if (error) {
    return (
      <div className={`${homeViewportClass} content-wrapper`}>
        <section className="flex h-full min-h-0 items-center justify-center overflow-hidden text-center fade-in">
          <div className="text-red-500 dark:text-red-400">
            <h2 className="text-2xl font-bold mb-4">加载失败</h2>
            <p>{error}</p>
          </div>
        </section>
      </div>
    );
  }

  const skeletonContent = (
    <div className={homeContentClass}>
      <section className={homeSectionClass}>
        <div className="mb-6 md:mb-8">
          <div className="h-16 w-64 mx-auto mb-4 shimmer rounded md:w-96" />
        </div>
        
        <div className="h-6 w-2/3 mx-auto mb-5 shimmer rounded md:mb-8" />
        
        <div className="max-w-3xl mx-auto">
          <div className="h-4 w-full mb-2 shimmer rounded" />
          <div className="h-4 w-5/6 mx-auto shimmer rounded" />
        </div>

        <div className="h-7 w-40 mx-auto mt-7 shimmer rounded md:mt-10" />
        <div className="mt-6 grid w-full max-w-md grid-cols-2 gap-x-4 gap-y-2 border-y border-neutral-200 py-2 dark:border-neutral-800 md:max-w-xl">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-5 shimmer rounded" />
          ))}
        </div>
      </section>
    </div>
  );

  const actualContent = (
    <div className={homeContentClass}>
      {/* Hero + Introduction Section */}
      <section className={`${homeSectionClass} fade-in-up`}>
        <div className="mb-6 md:mb-8">
          <TypewriterTitle 
            text={config?.title || ''}
            typeSpeed={120}
            deleteSpeed={80}
            pauseDuration={3000}
            restartPause={1500}
            className="text-4xl md:text-6xl lg:text-7xl text-neutral-900 dark:text-neutral-100 mb-4"
          />
        </div>

        <div className="max-w-3xl mx-auto fade-in-delayed" style={{ animationDelay: '0.4s' }}>
          <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed text-base">
            {config?.introduction || ''}
          </p>
        </div>

        <div
          className="mt-7 flex items-center justify-center gap-2 text-xl font-medium text-neutral-900 dark:text-neutral-100 fade-in-delayed md:mt-10"
          style={{ animationDelay: '0.6s' }}
        >
          <span className="text-neutral-500 dark:text-neutral-500" aria-hidden="true">
            $
          </span>
          <Link
            href="/posts"
            className="text-neutral-900 dark:text-neutral-100 transition-smooth"
          >
            Enter
          </Link>
          <CornerDownLeft className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
        </div>

        <div
          className="mx-auto mt-6 w-full max-w-md fade-in-delayed md:max-w-lg"
          style={{ animationDelay: '0.8s' }}
        >
          <div className="mb-2 text-left text-sm text-neutral-500 dark:text-neutral-500">
            <span aria-hidden="true">$ </span>
            ls ./categories
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-1 border-y border-neutral-300 py-3 dark:border-neutral-700 md:gap-x-10">
            {POST_CATEGORIES.map(category => (
              <Link
                key={category}
                href={`/categories/${encodeSlug(category)}` as any}
                className="no-link-underline group flex items-center justify-center gap-2 px-1.5 py-1.5 text-center text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100 md:text-base"
              >
                <span className="text-neutral-500 dark:text-neutral-500" aria-hidden="true">
                  $
                </span>
                <span>cd ./{category}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
  
  return (
    <LoadingTransition
      loading={loading || !config}
      skeleton={skeletonContent}
      className={`${homeViewportClass} home-page-shell`}
      delay={300}
    >
      {actualContent}
    </LoadingTransition>
  );
}
