'use client';

import { ReactNode, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FileText,
  Files,
  Home,
  ImageIcon,
  LayoutDashboard,
  Moon,
  Settings,
  Sun,
  type LucideIcon,
} from 'lucide-react';
import { useEffect } from 'react';

interface AdminLayoutProps {
  children: ReactNode;
}

const menuItems: Array<{
  path: '/admin' | '/admin/posts' | '/admin/pages' | '/admin/media' | '/admin/settings';
  label: string;
  icon: LucideIcon;
}> = [
  { path: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/admin/posts', label: 'Posts', icon: FileText },
  { path: '/admin/pages', label: 'Pages', icon: Files },
  { path: '/admin/media', label: 'Media', icon: ImageIcon },
  { path: '/admin/settings', label: 'Settings', icon: Settings },
];

export function AdminLayout({ children }: AdminLayoutProps) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [isDark, setIsDark] = useState(false);

  // 主题切换逻辑
  useEffect(() => {
    const saved = localStorage.getItem('theme');
    const isDarkMode = saved === 'dark' || 
      (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches);
    
    setIsDark(isDarkMode);
    document.documentElement.classList.toggle('dark', isDarkMode);
  }, []);

  const toggleTheme = () => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    document.documentElement.classList.toggle('dark', newIsDark);
    localStorage.setItem('theme', newIsDark ? 'dark' : 'light');
  };

  const handleLogout = () => {
    setShowLogoutConfirm(false);
    logout();
  };

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-900 font-mono">
      {/* 顶部终端式标题栏 (固定定位) */}
      <div className="fixed top-0 left-0 right-0 z-40 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center space-x-4">
            <div className="text-neutral-900 dark:text-neutral-100 font-medium">
              {'>'} Admin Panel
            </div>
            <div className="text-neutral-500 dark:text-neutral-400 text-sm">
              [{user?.userId}@tiny-blog]
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            {/* 首页图标 */}
            <Link
              href="/"
              className="p-2 text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
              title="返回首页"
            >
              <Home className="h-4 w-4" />
            </Link>
            
            {/* 主题切换图标 */}
            <button
              onClick={toggleTheme}
              className="p-2 text-neutral-600 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors"
              title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
            >
              {isDark ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
            
            {/* 分隔符 */}
            <div className="w-px h-4 bg-neutral-300 dark:bg-neutral-600 mx-1"></div>
            
            {/* 退出登录 */}
            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="text-neutral-600 dark:text-neutral-300 hover:text-red-500 dark:hover:text-red-400 transition-colors text-sm"
            >
              [logout]
            </button>
          </div>
        </div>
      </div>

      <div className="flex pt-[61px]">
        {/* 侧边导航 - 终端式菜单 (固定定位) */}
        <div className="w-64 bg-neutral-100 dark:bg-neutral-800 border-r border-neutral-200 dark:border-neutral-700 h-[calc(100vh-61px)] fixed left-0 top-[61px] overflow-y-auto z-30">
          <div className="p-4">
            <div className="text-neutral-600 dark:text-neutral-400 text-sm mb-4">
              ─── MENU ─────────
            </div>
            <nav className="space-y-1">
              {menuItems.map((item) => {
                const isActive = pathname === item.path;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    className={`flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
                      isActive
                        ? 'bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900'
                        : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                    }`}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          
          {/* 终端式状态信息 (固定在侧边栏底部) */}
          <div className="absolute bottom-4 left-4 right-4">
            <div className="text-xs text-neutral-500 dark:text-neutral-400 space-y-1">
              <div>─── STATUS ──────────</div>
              <div>• Online</div>
              <div>• {new Date().toLocaleTimeString()}</div>
            </div>
          </div>
        </div>

        {/* 主内容区域 (添加左边距以适应固定侧边栏) */}
        <div className="flex-1 ml-64 p-6 min-h-[calc(100vh-61px)]">
          {children}
        </div>
      </div>

      {/* 退出确认对话框 */}
      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-300 dark:border-neutral-600 rounded p-6 max-w-sm mx-4">
            <div className="text-neutral-900 dark:text-neutral-100 mb-4">
              {'>'} Confirm logout?
            </div>
            <div className="text-sm text-neutral-600 dark:text-neutral-400 mb-6">
              Are you sure you want to logout from admin panel?
            </div>
            <div className="flex space-x-3 justify-end">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="px-4 py-2 text-sm bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-300 rounded hover:bg-neutral-300 dark:hover:bg-neutral-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
