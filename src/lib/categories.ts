export const POST_CATEGORIES = [
  '架构',
  '开发',
  '原理',
  'AI栈',
  '运维',
  '工具',
  '硬件',
  '随笔',
] as const;

export type PostCategory = (typeof POST_CATEGORIES)[number];

export function normalizeCategory(category?: string): string | undefined {
  const normalized = category?.trim();
  return normalized || undefined;
}
