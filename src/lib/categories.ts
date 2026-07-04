export const POST_CATEGORIES = [
  '项目',
  '架构',
  '原理',
  '运维',
  '开发',
  'AI栈',
  '工具',
  '随笔',
] as const;

export type PostCategory = (typeof POST_CATEGORIES)[number];

export function normalizeCategory(category?: string): string | undefined {
  const normalized = category?.trim();
  return normalized || undefined;
}
