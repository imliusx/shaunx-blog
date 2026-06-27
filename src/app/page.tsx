'use client';

import Link from 'next/link';
import { CornerDownLeft } from 'lucide-react';
import { TypewriterTitle } from '@/components/TypewriterTitle';
import { useConfig } from '@/hooks/useConfig';
import { LoadingTransition } from '@/components/LoadingComponents';

export default function HomePage() {
  const { data: config, loading, error } = useConfig();

  if (error) {
    return (
      <div className="content-wrapper h-[calc(100dvh-72px)] overflow-hidden">
        <section className="flex h-full items-center justify-center text-center fade-in">
          <div className="text-red-500 dark:text-red-400">
            <h2 className="text-2xl font-bold mb-4">加载失败</h2>
            <p>{error}</p>
          </div>
        </section>
      </div>
    );
  }

  const skeletonContent = (
    <div className="content-wrapper h-[calc(100dvh-72px)] overflow-hidden">
      <section className="flex h-full flex-col items-center justify-center py-8 text-center md:py-10">
        <div className="mb-8 md:mb-10">
          <div className="h-16 w-64 mx-auto mb-4 shimmer rounded md:w-96" />
        </div>
        
        <div className="h-6 w-2/3 mx-auto mb-8 shimmer rounded md:mb-10" />
        
        <div className="max-w-3xl mx-auto">
          <div className="h-4 w-full mb-2 shimmer rounded" />
          <div className="h-4 w-5/6 mx-auto shimmer rounded" />
        </div>

        <div className="h-7 w-40 mx-auto mt-10 shimmer rounded md:mt-12" />
      </section>
    </div>
  );

  const actualContent = (
    <div className="content-wrapper h-[calc(100dvh-72px)] overflow-hidden">
      {/* Hero + Introduction Section */}
      <section className="flex h-full flex-col items-center justify-center py-8 text-center md:py-10 fade-in-up">
        <div className="mb-8 md:mb-10">
          <TypewriterTitle 
            text={config?.title || ''}
            typeSpeed={120}
            deleteSpeed={80}
            pauseDuration={3000}
            restartPause={1500}
            className="text-4xl md:text-6xl lg:text-7xl text-neutral-900 dark:text-neutral-100 mb-4"
          />
        </div>
        
        <p className="text-lg md:text-xl text-neutral-600 dark:text-neutral-400 mb-8 max-w-2xl mx-auto leading-relaxed fade-in-delayed md:mb-10">
          {config?.description || ''}
        </p>
        
        {/* Introduction content */}
        <div className="max-w-3xl mx-auto fade-in-delayed" style={{ animationDelay: '0.4s' }}>
          <p className="text-neutral-600 dark:text-neutral-400 leading-relaxed text-base">
            {config?.introduction || ''}
          </p>
        </div>

        <div
          className="mt-10 flex items-center justify-center gap-2 text-xl font-medium text-neutral-900 dark:text-neutral-100 fade-in-delayed md:mt-12"
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
      </section>
    </div>
  );
  
  return (
    <LoadingTransition
      loading={loading || !config}
      skeleton={skeletonContent}
      delay={300}
    >
      {actualContent}
    </LoadingTransition>
  );
}
