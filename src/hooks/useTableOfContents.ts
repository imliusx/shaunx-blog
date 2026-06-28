'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { TOCItem } from '@/types/toc';
import { extractHeadings, buildHeadingTree, scrollToHeading } from '@/lib/toc';

interface UseTableOfContentsOptions {
  htmlContent?: string;
  offsetTop?: number;
  rootMargin?: string;
  threshold?: number | number[];
}

export function useTableOfContents({
  htmlContent,
  offsetTop = 80
}: UseTableOfContentsOptions = {}) {
  const [headings, setHeadings] = useState<TOCItem[]>([]);
  const [flatHeadings, setFlatHeadings] = useState<TOCItem[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [isVisible, setIsVisible] = useState(false);
  const frameRef = useRef<number | null>(null);
  const activeIdRef = useRef('');

  // 提取和构建标题树
  useEffect(() => {
    if (!htmlContent) {
      setHeadings([]);
      setFlatHeadings([]);
      return;
    }

    const extractedHeadings = extractHeadings(htmlContent);
    const tree = buildHeadingTree(extractedHeadings);
    
    setHeadings(tree);
    setFlatHeadings(extractedHeadings);
  }, [htmlContent]);

  // 根据滚动位置计算当前标题，避免标题交界处 IntersectionObserver 反复切换。
  useEffect(() => {
    if (typeof window === 'undefined' || flatHeadings.length === 0) return;

    const getHeadingElements = () => (
      flatHeadings
        .map((heading) => ({
          id: heading.id,
          element: document.getElementById(heading.id)
        }))
        .filter((item): item is { id: string; element: HTMLElement } => Boolean(item.element))
    );

    const updateActiveHeading = () => {
      const headingElements = getHeadingElements();
      if (headingElements.length === 0) return;

      const scrollTop = window.scrollY;
      const activationY = scrollTop + offsetTop + 24;
      let nextActiveId = headingElements[0].id;

      for (const heading of headingElements) {
        if (heading.element.offsetTop <= activationY) {
          nextActiveId = heading.id;
        } else {
          break;
        }
      }

      if (nextActiveId !== activeIdRef.current) {
        activeIdRef.current = nextActiveId;
        setActiveId(nextActiveId);
      }
    };

    const scheduleUpdate = () => {
      if (frameRef.current !== null) return;

      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        updateActiveHeading();
      });
    };

    const timer = window.setTimeout(updateActiveHeading, 100);

    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);

      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [flatHeadings, offsetTop]);

  // 检查是否应该显示目录（至少有2个标题）
  useEffect(() => {
    setIsVisible(flatHeadings.length >= 2);
  }, [flatHeadings]);

  // 滚动到指定标题
  const handleScrollToHeading = useCallback((id: string) => {
    scrollToHeading(id, offsetTop);
    activeIdRef.current = id;
    setActiveId(id);
  }, [offsetTop]);

  return {
    headings,
    flatHeadings,
    activeId,
    isVisible,
    scrollToHeading: handleScrollToHeading
  };
}
