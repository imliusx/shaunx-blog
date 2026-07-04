import {
  Bot,
  FolderKanban,
  Hammer,
  Lightbulb,
  Network,
  PenLine,
  ServerCog,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react';

interface CategoryIconProps {
  category?: string;
  className?: string;
  strokeWidth?: number;
}

const categoryIcons: Record<string, LucideIcon> = {
  '架构': Network,
  '开发': TerminalSquare,
  '原理': Lightbulb,
  'AI栈': Bot,
  '运维': ServerCog,
  '工具': Hammer,
  '项目': FolderKanban,
  '随笔': PenLine,
};

export function CategoryIcon({
  category,
  className,
  strokeWidth = 1.8,
}: CategoryIconProps) {
  const Icon = category ? categoryIcons[category] ?? TerminalSquare : TerminalSquare;
  return <Icon className={className} strokeWidth={strokeWidth} aria-hidden="true" />;
}
