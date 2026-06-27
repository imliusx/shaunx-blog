'use client';

import { useEffect, useState } from 'react';
import { PostMeta } from '@/types';
import { encodeSlug } from '@/lib/slug';

interface CategoriesState {
  categories: { category: string; count: number }[];
  loading: boolean;
  error: string | null;
}

interface CategoryPostsState {
  category: string;
  posts: PostMeta[];
  count: number;
  loading: boolean;
  error: string | null;
}

export function useCategories() {
  const [state, setState] = useState<CategoriesState>({
    categories: [],
    loading: true,
    error: null,
  });

  const fetchCategories = async () => {
    try {
      setState(prev => ({ ...prev, loading: true, error: null }));

      const response = await fetch('/api/categories', {
        cache: 'no-cache',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        setState({
          categories: result.data,
          loading: false,
          error: null,
        });
      } else {
        throw new Error(result.error || '获取类别失败');
      }
    } catch (error) {
      setState({
        categories: [],
        loading: false,
        error: error instanceof Error ? error.message : '获取类别失败',
      });
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  return {
    ...state,
    refetch: fetchCategories,
  };
}

export function useCategoryPosts(category: string) {
  const [state, setState] = useState<CategoryPostsState>({
    category: '',
    posts: [],
    count: 0,
    loading: true,
    error: null,
  });

  const fetchCategoryPosts = async () => {
    if (!category) return;

    try {
      setState(prev => ({ ...prev, loading: true, error: null }));

      const response = await fetch(`/api/categories/${encodeSlug(category)}`, {
        cache: 'no-cache',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (result.success) {
        setState({
          category: result.data.category,
          posts: result.data.posts,
          count: result.data.count,
          loading: false,
          error: null,
        });
      } else {
        throw new Error(result.error || '获取类别文章失败');
      }
    } catch (error) {
      setState({
        category: '',
        posts: [],
        count: 0,
        loading: false,
        error: error instanceof Error ? error.message : '获取类别文章失败',
      });
    }
  };

  useEffect(() => {
    fetchCategoryPosts();
  }, [category]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    ...state,
    refetch: fetchCategoryPosts,
  };
}
