'use client';

import { useRef } from 'react';
import { SiteConfig } from '@/types';
import { Download, RotateCcw, Upload } from 'lucide-react';

interface ConfigManagerProps {
  config: SiteConfig | null;
  onImport: (config: SiteConfig) => void;
  onReset: () => void;
}

export function ConfigManager({ config, onImport, onReset }: ConfigManagerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 导出配置
  const handleExport = () => {
    if (!config) return;

    const configData = JSON.stringify(config, null, 2);
    const blob = new Blob([configData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `site-config-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
  };

  // 导入配置
  const handleImport = () => {
    fileInputRef.current?.click();
  };

  // 处理文件选择
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const configData = JSON.parse(e.target?.result as string);
        
        // 基本验证
        if (typeof configData === 'object' && configData.title && configData.author) {
          onImport(configData);
        } else {
          alert('配置文件格式不正确，请选择有效的配置文件');
        }
      } catch (error) {
        alert('配置文件解析失败，请检查文件格式');
      }
    };
    
    reader.readAsText(file);
    // 清空input值，允许重复选择同一文件
    event.target.value = '';
  };

  // 重置配置
  const handleReset = () => {
    const confirmed = window.confirm(
      '确定要重置配置吗？这将恢复所有设置到默认值，此操作不可撤销。'
    );
    
    if (confirmed) {
      onReset();
    }
  };

  return (
    <div className="bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg p-6">
      <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100 mb-4">
        {'>'} 配置管理
      </h3>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 导出配置 */}
        <button
          onClick={handleExport}
          disabled={!config}
          className="flex flex-col items-center p-6 border border-neutral-300 dark:border-neutral-600 rounded-lg hover:border-neutral-900 dark:hover:border-neutral-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-neutral-50 dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800 font-mono"
        >
          <Download className="mb-3 h-7 w-7 text-neutral-700 dark:text-neutral-300" />
          <div className="text-neutral-900 dark:text-neutral-100 font-medium mb-2">
            [export config]
          </div>
          <div className="text-xs text-neutral-600 dark:text-neutral-400 text-center">
            Download current configuration as JSON file
          </div>
        </button>

        {/* 导入配置 */}
        <button
          onClick={handleImport}
          className="flex flex-col items-center p-6 border border-neutral-300 dark:border-neutral-600 rounded-lg hover:border-neutral-900 dark:hover:border-neutral-100 transition-colors bg-neutral-50 dark:bg-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800 font-mono"
        >
          <Upload className="mb-3 h-7 w-7 text-neutral-700 dark:text-neutral-300" />
          <div className="text-neutral-900 dark:text-neutral-100 font-medium mb-2">
            [import config]
          </div>
          <div className="text-xs text-neutral-600 dark:text-neutral-400 text-center">
            Restore configuration from JSON file
          </div>
        </button>

        {/* 重置配置 */}
        <button
          onClick={handleReset}
          className="flex flex-col items-center p-6 border border-neutral-300 dark:border-neutral-600 rounded-lg hover:border-red-500 dark:hover:border-red-400 transition-colors bg-neutral-50 dark:bg-neutral-900 hover:bg-red-50 dark:hover:bg-red-950 font-mono group"
        >
          <RotateCcw className="mb-3 h-7 w-7 text-neutral-700 dark:text-neutral-300 group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors" />
          <div className="text-neutral-900 dark:text-neutral-100 font-medium mb-2 group-hover:text-red-600 dark:group-hover:text-red-400 transition-colors">
            [reset config]
          </div>
          <div className="text-xs text-neutral-600 dark:text-neutral-400 text-center">
            Restore to default settings
          </div>
        </button>
      </div>

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* 使用说明 */}
      <div className="mt-6 p-4 bg-neutral-200 dark:bg-neutral-700 rounded text-sm text-neutral-600 dark:text-neutral-300 font-mono">
        <div className="font-medium mb-2">{'>'} Usage Instructions:</div>
        <div className="space-y-1 text-xs pl-4">
          <div>• Export: Save current configuration as JSON file for backup</div>
          <div>• Import: Restore configuration from JSON file (will overwrite current settings)</div>
          <div>• Reset: Restore all settings to system defaults</div>
          <div>• Tip: Export current config before importing for safety</div>
        </div>
      </div>
    </div>
  );
}
