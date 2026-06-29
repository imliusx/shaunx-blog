import Link from 'next/link';
import Image from 'next/image';
import { Calendar, Clock } from 'lucide-react';
import type { PostMeta } from '@/types';
import { formatDate } from '@/lib/utils';
import { encodeSlug } from '@/lib/slug';
import { TagList } from './TagList';
import { CategoryIcon } from './CategoryIcon';

interface PostCardProps {
  post: PostMeta;
}

export function PostCard({ post }: PostCardProps) {
  const postHref = `/posts/${encodeSlug(post.slug)}` as any;

  return (
    <article className="card transition-all duration-200 hover:shadow-md overflow-hidden md:min-h-48">
      <div className="flex h-full flex-col md:flex-row">
        {/* 封面图片区域 */}
        {post.cover && (
          <div className="relative h-48 w-full flex-shrink-0 md:min-h-48 md:w-64">
            <Image
              src={post.cover}
              alt={post.title}
              fill
              className="object-cover"
            />
          </div>
        )}
        
        {/* 内容区域 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col px-6 py-5">
          <div className="min-w-0 flex-1 overflow-visible">
            <h3 className="mb-2 min-w-0 text-xl font-semibold leading-snug">
              <Link 
                href={postHref}
                className="inline break-words pb-1 text-neutral-900 dark:text-neutral-100"
              >
                {post.title}
              </Link>
            </h3>
            
            {post.excerpt && (
              <div className="relative mb-3 min-w-0 overflow-hidden text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                <p className="overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)] [-webkit-mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]">
                  {post.excerpt}
                </p>
              </div>
            )}
            
            {post.tags.length > 0 && (
              <div className="min-h-8 overflow-visible pb-1 md:overflow-hidden">
                <TagList tags={post.tags} className="md:flex-nowrap md:overflow-hidden" />
              </div>
            )}
          </div>
          
          {/* 底部元信息 */}
          <div>
            <div className="mt-2 mb-3 h-px bg-[repeating-linear-gradient(to_right,currentColor_0,currentColor_8px,transparent_8px,transparent_14px)] text-neutral-300 dark:text-neutral-700" />
            <div className="text-sm leading-5 text-neutral-500 dark:text-neutral-500">
              <div className="grid grid-cols-[minmax(0,1fr),auto] gap-x-3 gap-y-2 sm:hidden">
                <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="inline-flex items-center gap-1 whitespace-nowrap">
                    <Calendar className="h-4 w-4" />
                    <time dateTime={post.date}>
                      {formatDate(post.date)}
                    </time>
                  </div>

                  {post.category && (
                    <Link
                      href={`/categories/${encodeSlug(post.category)}` as any}
                      className="no-link-underline inline-flex items-center gap-1 whitespace-nowrap text-inherit hover:text-inherit"
                      style={{ color: 'inherit' }}
                    >
                      <CategoryIcon category={post.category} className="h-4 w-4" />
                      <span>./{post.category}</span>
                    </Link>
                  )}
                </div>
                
                {post.readingTime && (
                  <div className="col-start-1 row-start-2 inline-flex items-center gap-1 whitespace-nowrap">
                    <Clock className="h-4 w-4" />
                    <span>{post.readingTime}分钟阅读</span>
                  </div>
                )}
                
                <Link 
                  href={postHref}
                  className="col-start-2 row-start-2 inline-block justify-self-end whitespace-nowrap pb-1 text-right font-medium text-neutral-600 dark:text-neutral-400"
                >
                  阅读更多 -&gt;
                </Link>
              </div>
              
              <div className="hidden items-center justify-between sm:flex">
                <div className="flex items-center gap-x-4">
                  <div className="inline-flex items-center gap-1 whitespace-nowrap">
                    <Calendar className="h-4 w-4" />
                    <time dateTime={post.date}>
                      {formatDate(post.date)}
                    </time>
                  </div>

                  {post.category && (
                    <Link
                      href={`/categories/${encodeSlug(post.category)}` as any}
                      className="no-link-underline inline-flex items-center gap-1 whitespace-nowrap text-inherit hover:text-inherit"
                      style={{ color: 'inherit' }}
                    >
                      <CategoryIcon category={post.category} className="h-4 w-4" />
                      <span>./{post.category}</span>
                    </Link>
                  )}
                  
                  {post.readingTime && (
                    <div className="inline-flex items-center gap-1 whitespace-nowrap">
                      <Clock className="h-4 w-4" />
                      <span>{post.readingTime}分钟阅读</span>
                    </div>
                  )}
                </div>
                
                <Link 
                  href={postHref}
                  className="inline-block whitespace-nowrap pb-1 text-right font-medium text-neutral-600 dark:text-neutral-400"
                >
                  阅读更多 -&gt;
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
