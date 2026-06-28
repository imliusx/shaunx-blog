'use client';

import Link from 'next/link';
import { ArrowLeft, Folder } from 'lucide-react';
import { useParams } from 'next/navigation';
import { LoadingTransition } from '@/components/LoadingComponents';
import { PostCard } from '@/components/PostCard';
import { useCategoryPosts } from '@/hooks/useCategories';
import { CategoryIcon } from '@/components/CategoryIcon';

export default function CategoryPostsPage() {
  const params = useParams();
  const category = decodeURIComponent(params.category as string);
  const { posts, count, loading, error } = useCategoryPosts(category);

  if (error) {
    return (
      <div className="content-wrapper py-12">
        <div className="text-center py-16 fade-in">
          <div className="text-red-500 dark:text-red-400">
            <h2 className="text-2xl font-semibold mb-4">加载失败</h2>
            <p>{error}</p>
            <Link 
              href="/categories" 
              className="inline-flex items-center mt-4 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回类别列表
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const skeletonContent = (
    <div className="content-wrapper py-12">
      <div className="mb-8">
        <div className="h-6 w-32 shimmer rounded mb-4"></div>
        <div className="h-8 w-64 shimmer rounded mb-4"></div>
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
  );

  const actualContent = (
    <div className="content-wrapper py-12">
      <div className="mb-8 fade-in">
        <Link 
          href="/categories" 
          className="inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          返回类别列表
        </Link>
      </div>

      <div className="mb-8 fade-in-up">
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <CategoryIcon
            category={category}
            className="h-7 w-7 shrink-0 text-neutral-500 dark:text-neutral-400"
          />
          <h1 className="text-2xl font-bold">{category}</h1>
          <p className="text-muted-foreground">
            $ find ./posts -category {category} | wc -l = {count}
          </p>
        </div>
      </div>

      {posts.length > 0 ? (
        <div className="space-y-6 stagger-children">
          {posts.map((post) => (
            <PostCard key={post.slug} post={post} />
          ))}
        </div>
      ) : (
        <div className="text-center py-16 fade-in-delayed">
          <Folder className="h-16 w-16 text-muted-foreground/50 mx-auto mb-4" />
          <h2 className="text-2xl font-semibold mb-4">暂无文章</h2>
          <p className="text-muted-foreground">
            该类别下还没有任何文章。
          </p>
        </div>
      )}
    </div>
  );

  return (
    <LoadingTransition loading={loading} skeleton={skeletonContent} delay={300}>
      {actualContent}
    </LoadingTransition>
  );
}
