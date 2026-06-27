'use client';

import { ProtectedAdminPage } from '@/components/ProtectedAdminPage';
import { SettingsForm } from '@/components/SettingsForm';
import { ConfigManager } from '@/components/ConfigManager';
import { useConfig } from '@/hooks/useConfig';
import { useAuth } from '@/hooks/useAuth';
import { SiteConfig } from '@/types';
import { useState } from 'react';
import Cookies from 'js-cookie';
import { CheckCircle2, XCircle } from 'lucide-react';

export default function AdminSettings() {
  const { data: config, loading, refetch } = useConfig();
  const { user } = useAuth();
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSaveConfig = async (newConfig: SiteConfig) => {
    try {
      setSaveMessage(null);
      setSaveError(null);

      const token = Cookies.get('admin-token');
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`,
        },
        body: JSON.stringify(newConfig),
      });

      const result = await response.json();

      if (result.success) {
        setSaveMessage('配置保存成功！');
        // 重新加载配置
        await refetch();
        
        // 3秒后清除成功消息
        setTimeout(() => setSaveMessage(null), 3000);
      } else {
        setSaveError(result.error || '保存配置失败');
        if (result.errors && Array.isArray(result.errors)) {
          setSaveError(result.errors.join(', '));
        }
      }
    } catch (error) {
      setSaveError('网络错误，请稍后重试');
      console.error('保存配置失败:', error);
    }
  };

  // 处理配置导入
  const handleImportConfig = async (importedConfig: SiteConfig) => {
    try {
      setSaveMessage(null);
      setSaveError(null);

      const token = Cookies.get('admin-token');
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`,
        },
        body: JSON.stringify(importedConfig),
      });

      const result = await response.json();

      if (result.success) {
        setSaveMessage('配置导入成功！');
        await refetch();
        setTimeout(() => setSaveMessage(null), 3000);
      } else {
        setSaveError(result.error || '导入配置失败');
        if (result.errors && Array.isArray(result.errors)) {
          setSaveError(result.errors.join(', '));
        }
      }
    } catch (error) {
      setSaveError('导入配置失败，请稍后重试');
      console.error('导入配置失败:', error);
    }
  };

  // 处理配置重置
  const handleResetConfig = async () => {
    try {
      setSaveMessage(null);
      setSaveError(null);

      // 使用默认配置
      const defaultConfig: SiteConfig = {
        title: "Lynn's Blog",
        description: "😜Yes, I broke it. No, I didn't mean to. Yes, I learned something.",
        introduction: '"Do not go gentle into that good night. Old age should burn and rave at close of day. Rage, rage against the dying of the light."',
        author: {
          name: 'Lynn',
          email: 'blog@example.com',
          github: 'github-username'
        },
        url: 'https://your-blog.com',
        social: {
          github: 'https://github.com/imliusx',
          twitter: 'https://twitter.com/username',
          email: 'mailto:ftfetters@gmail.com'
        },
        theme: {
          primaryColor: '#3b82f6'
        },
        nav: [
          { name: 'Home', href: '/' },
          { name: 'Posts', href: '/posts' },
          { name: 'Tags', href: '/tags' },
          { name: 'About', href: '/about' }
        ],
        postsPerPage: 6,
        excerptLength: 200,
        secureEntrance: ''
      };

      const token = Cookies.get('admin-token');
      const response = await fetch('/api/config', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`,
        },
        body: JSON.stringify(defaultConfig),
      });

      const result = await response.json();

      if (result.success) {
        setSaveMessage('配置重置成功！');
        await refetch();
        setTimeout(() => setSaveMessage(null), 3000);
      } else {
        setSaveError(result.error || '重置配置失败');
      }
    } catch (error) {
      setSaveError('重置配置失败，请稍后重试');
      console.error('重置配置失败:', error);
    }
  };

  return (
    <ProtectedAdminPage>
      <div className="max-w-6xl mx-auto">
        {/* 页面标题 */}
        <div className="mb-8">
          <div className="text-2xl font-medium text-neutral-900 dark:text-neutral-100 mb-2">
            {'>'} Settings
          </div>
          <div className="text-neutral-600 dark:text-neutral-400 text-sm">
            ──────────────────────────────────────────────
          </div>
          <div className="mt-4 text-neutral-700 dark:text-neutral-300">
            管理站点配置、主题设置和其他选项
          </div>
        </div>

        {/* 状态消息 */}
        {saveMessage && (
          <div className="mb-6 flex items-center gap-2 p-4 bg-green-100 dark:bg-green-900 border border-green-200 dark:border-green-700 rounded text-green-800 dark:text-green-200">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            <span>{saveMessage}</span>
          </div>
        )}

        {saveError && (
          <div className="mb-6 flex items-center gap-2 p-4 bg-red-100 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded text-red-800 dark:text-red-200">
            <XCircle className="h-4 w-4 flex-shrink-0" />
            <span>{saveError}</span>
          </div>
        )}

        {/* 加载状态 */}
        {loading && (
          <div className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded p-8">
            <div className="flex items-center justify-center text-neutral-600 dark:text-neutral-400">
              <div className="flex items-center space-x-3">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-current"></div>
                <span>加载配置中...</span>
              </div>
            </div>
          </div>
        )}

        {/* 设置表单 */}
        {!loading && (
          <>
            <SettingsForm
              initialConfig={config}
              onSave={handleSaveConfig}
              loading={loading}
            />

            {/* 配置管理 */}
            <div className="mt-8">
              <ConfigManager
                config={config}
                onImport={handleImportConfig}
                onReset={handleResetConfig}
              />
            </div>

            {/* 附加信息 */}
            <div className="mt-8 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded p-6">
              <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-4">
                {'>'} 配置说明
              </h3>
              <div className="space-y-3 text-sm text-neutral-600 dark:text-neutral-400">
                <div>• <strong>基本设置</strong>: 站点标题、描述等基础信息</div>
                <div>• <strong>作者信息</strong>: 显示在文章和页面中的作者信息</div>
                <div>• <strong>社交链接</strong>: 在站点中显示的社交媒体链接</div>
                <div>• <strong>导航菜单</strong>: 站点顶部导航栏的菜单项</div>
                <div>• <strong>高级设置</strong>: 分页、摘要长度、主题色等高级选项</div>
                <div>• <strong>安全入口</strong>: 设置管理后台的访问密钥（可选）</div>
              </div>
              
              <div className="mt-4 pt-4 border-t border-neutral-300 dark:border-neutral-600 text-xs text-neutral-500 dark:text-neutral-400">
                <div>配置文件位置: config/site.config.json</div>
                <div>更改将立即生效，无需重启服务</div>
              </div>
            </div>
          </>
        )}
      </div>
    </ProtectedAdminPage>
  );
}
