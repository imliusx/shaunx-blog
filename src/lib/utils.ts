import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function calculateReadingTime(content: string): number {
  const wordsPerMinute = 200;
  const words = content.trim().split(/\s+/).length;
  return Math.ceil(words / wordsPerMinute);
}

export function generateExcerpt(content: string, length: number = 200): string {
  const text = content.replace(/[#*`]/g, '').trim();
  if (text.length <= length) return text;
  return text.slice(0, length).trim() + '...';
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * 把配置中的邮箱规范成可点击的mailto链接
 * 配置里允许填裸邮箱或完整mailto链接，两种都要能正确跳转
 */
export function toMailtoHref(email: string): string {
  const trimmed = email.trim();
  return trimmed.startsWith('mailto:') ? trimmed : `mailto:${trimmed}`;
}