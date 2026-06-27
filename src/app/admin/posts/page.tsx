'use client';

import { ProtectedAdminPage } from '@/components/ProtectedAdminPage';
import { TagFilter } from '@/components/TagFilter';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Calendar, Hash, Tags } from 'lucide-react';

interface AdminPost {
  slug: string;
  title: string;
  date: string;
  published: boolean;
  tags: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export default function AdminPosts() {
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPosts, setSelectedPosts] = useState<string[]>([]);
  const [filter, setFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [selectedTag, setSelectedTag] = useState<string>('');

  const fetchPosts = useCallback(async () => {
    try {
      setLoading(true);
      const url = new URL('/api/admin/posts', window.location.origin);
      if (selectedTag) {
        url.searchParams.set('tag', selectedTag);
      }
      
      const response = await fetch(url.toString(), {
        credentials: 'include',
      });
      const data = await response.json();
      
      if (data.success) {
        setPosts(data.data);
      } else {
        console.error('获取文章列表失败:', data.error);
      }
    } catch (error) {
      console.error('获取文章列表失败:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedTag]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

  const handleDelete = async (slug: string) => {
    if (!confirm(`确定要删除文章 "${slug}" 吗？`)) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/posts/${slug}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      const data = await response.json();
      
      if (data.success) {
        setPosts(posts.filter(post => post.slug !== slug));
      } else {
        alert('删除失败: ' + data.error);
      }
    } catch (error) {
      console.error('删除文章失败:', error);
      alert('删除失败');
    }
  };

  const togglePostSelection = (slug: string) => {
    setSelectedPosts(prev =>
      prev.includes(slug)
        ? prev.filter(s => s !== slug)
        : [...prev, slug]
    );
  };

  const handleBatchDelete = async () => {
    if (selectedPosts.length === 0) return;
    
    if (!confirm(`确定要删除 ${selectedPosts.length} 篇文章吗？`)) {
      return;
    }

    try {
      const deletePromises = selectedPosts.map(slug =>
        fetch(`/api/admin/posts/${slug}`, {
          method: 'DELETE',
          credentials: 'include',
        })
      );

      await Promise.all(deletePromises);
      setPosts(posts.filter(post => !selectedPosts.includes(post.slug)));
      setSelectedPosts([]);
    } catch (error) {
      console.error('批量删除失败:', error);
      alert('批量删除失败');
    }
  };

  const filteredPosts = posts.filter(post => {
    if (filter === 'published') return post.published;
    if (filter === 'draft') return !post.published;
    return true;
  });

  return (
    <ProtectedAdminPage>
      <div className="max-w-7xl mx-auto">
        {/* 标题和操作栏 */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <div className="text-2xl font-medium text-neutral-900 dark:text-neutral-100 mb-2">
              {'>'} Posts Management
            </div>
            <div className="text-neutral-600 dark:text-neutral-400 text-sm">
              ──────────────────────────────────────────────
            </div>
            {selectedTag && (
              <div className="mt-2 text-sm text-neutral-700 dark:text-neutral-300 font-mono">
                Filtering by tag: <span className="text-neutral-900 dark:text-neutral-100">[{selectedTag}]</span>
              </div>
            )}
          </div>
          <Link
            href="/admin/posts/new"
            className="bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900 px-4 py-2 rounded hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors font-mono"
          >
            [+ new post]
          </Link>
        </div>

        {/* 过滤器和批量操作 */}
        <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* 发布状态筛选 */}
            <div className="flex space-x-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1 text-sm rounded font-mono ${
                  filter === 'all'
                    ? 'bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900'
                    : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300'
                }`}
              >
                [All] ({posts.length})
              </button>
              <button
                onClick={() => setFilter('published')}
                className={`px-3 py-1 text-sm rounded font-mono ${
                  filter === 'published'
                    ? 'bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900'
                    : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300'
                }`}
              >
                [Published] ({posts.filter(p => p.published).length})
              </button>
              <button
                onClick={() => setFilter('draft')}
                className={`px-3 py-1 text-sm rounded font-mono ${
                  filter === 'draft'
                    ? 'bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900'
                    : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300'
                }`}
              >
                [Drafts] ({posts.filter(p => !p.published).length})
              </button>
            </div>
            
            {/* 标签筛选 */}
            <TagFilter 
              selectedTag={selectedTag}
              onTagChange={setSelectedTag}
            />
          </div>
          
          {selectedPosts.length > 0 && (
            <div className="flex items-center space-x-2">
              <span className="text-sm text-neutral-600 dark:text-neutral-400 font-mono">
                {selectedPosts.length} selected
              </span>
              <button
                onClick={handleBatchDelete}
                className="bg-red-500 text-white px-3 py-1 text-sm rounded hover:bg-red-600 transition-colors font-mono"
              >
                [delete selected]
              </button>
            </div>
          )}
        </div>

        {/* 文章列表 */}
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded p-4">
                <div className="skeleton h-6 w-64 mb-2"></div>
                <div className="skeleton h-4 w-32 mb-2"></div>
                <div className="skeleton h-4 w-96"></div>
              </div>
            ))}
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-neutral-500 dark:text-neutral-400 mb-4">
              No posts found.
            </div>
            <Link
              href="/admin/posts/new"
              className="inline-block bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900 px-4 py-2 rounded hover:bg-neutral-800 dark:hover:bg-neutral-200 transition-colors font-mono"
            >
              [create your first post]
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredPosts.map((post) => (
              <div
                key={post.slug}
                className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded p-4 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3 flex-1">
                    <input
                      type="checkbox"
                      checked={selectedPosts.includes(post.slug)}
                      onChange={() => togglePostSelection(post.slug)}
                      className="mt-1.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-2">
                        <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 truncate">
                          {post.title}
                        </h3>
                        <span className={`inline-block px-2 py-0.5 text-xs rounded ${
                          post.published
                            ? 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200'
                            : 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200'
                        }`}>
                          {post.published ? 'Published' : 'Draft'}
                        </span>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-600 dark:text-neutral-400 mb-2">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {post.date}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Hash className="h-3.5 w-3.5" />
                          {post.slug}
                        </span>
                        {post.tags.length > 0 && (
                          <span className="inline-flex items-center gap-1">
                            <Tags className="h-3.5 w-3.5" />
                            {post.tags.join(', ')}
                          </span>
                        )}
                      </div>
                      
                      {post.description && (
                        <p className="text-neutral-700 dark:text-neutral-300 text-sm line-clamp-2">
                          {post.description}
                        </p>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2 ml-4">
                    <a
                      href={`/posts/${post.slug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 text-sm"
                    >
                      View
                    </a>
                    <Link
                      href={`/admin/posts/${post.slug}/edit`}
                      className="text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 text-sm"
                    >
                      Edit
                    </Link>
                    <button
                      onClick={() => handleDelete(post.slug)}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ProtectedAdminPage>
  );
}
