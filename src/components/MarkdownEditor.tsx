'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { markdownToHtml } from '@/lib/markdown-client';
import {
  ArrowUpDown,
  Columns2,
  Eye,
  Link as LinkIcon,
  Maximize2,
  Minimize2,
  PencilLine,
} from 'lucide-react';

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  height?: string;
}

export function MarkdownEditor({ value, onChange, placeholder = '# 开始写作...', height = 'h-96' }: MarkdownEditorProps) {
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'edit' | 'preview' | 'split'>('split');
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // 滚动同步相关状态
  const [isScrollSync, setIsScrollSync] = useState(true);
  const [isScrollingSelf, setIsScrollingSelf] = useState(false);
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fullscreenEditorRef = useRef<HTMLTextAreaElement>(null);
  const fullscreenPreviewRef = useRef<HTMLDivElement>(null);

  // 更新预览内容
  const updatePreview = useCallback(async (markdown: string) => {
    if (!markdown.trim()) {
      setPreviewHtml('');
      return;
    }

    try {
      setIsPreviewLoading(true);
      const html = await markdownToHtml(markdown);
      setPreviewHtml(html);
    } catch (error) {
      console.error('Markdown预览生成失败:', error);
      setPreviewHtml('<p class="text-red-500">预览生成失败</p>');
    } finally {
      setIsPreviewLoading(false);
    }
  }, []);

  // 防抖更新预览
  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeTab === 'preview' || activeTab === 'split') {
        updatePreview(value);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [value, activeTab, updatePreview]);

  // 监听ESC键退出全屏
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    if (isFullscreen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden'; // 防止背景滚动
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [isFullscreen]);

  // 同步滚动处理函数
  const syncScroll = useCallback((sourceElement: HTMLElement, targetElement: HTMLElement) => {
    if (!isScrollSync || activeTab !== 'split' || isScrollingSelf) return;
    
    // 清除之前的防抖定时器
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    
    // 使用防抖优化性能
    scrollTimeoutRef.current = setTimeout(() => {
      setIsScrollingSelf(true);
      
      // 计算源元素的滚动百分比
      const scrollTop = sourceElement.scrollTop;
      const scrollHeight = sourceElement.scrollHeight;
      const clientHeight = sourceElement.clientHeight;
      const maxScroll = scrollHeight - clientHeight;
      
      if (maxScroll <= 0) {
        setIsScrollingSelf(false);
        return;
      }
      
      const scrollPercentage = scrollTop / maxScroll;
      
      // 应用到目标元素，使用平滑滚动
      const targetMaxScroll = targetElement.scrollHeight - targetElement.clientHeight;
      if (targetMaxScroll > 0) {
        const targetScrollTop = scrollPercentage * targetMaxScroll;
        
        // 使用requestAnimationFrame实现更平滑的滚动
        requestAnimationFrame(() => {
          targetElement.scrollTop = targetScrollTop;
          
          // 延迟重置标志，防止循环滚动
          setTimeout(() => {
            setIsScrollingSelf(false);
          }, 50);
        });
      } else {
        setIsScrollingSelf(false);
      }
    }, 16); // 约60fps的防抖频率
  }, [isScrollSync, activeTab, isScrollingSelf]);

  // 编辑区滚动处理
  const handleEditorScroll = useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const editor = e.target as HTMLTextAreaElement;
    const preview = isFullscreen ? fullscreenPreviewRef.current : previewRef.current;
    if (preview) {
      syncScroll(editor, preview);
    }
  }, [isFullscreen, syncScroll]);

  // 预览区滚动处理
  const handlePreviewScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const preview = e.target as HTMLDivElement;
    const editor = isFullscreen ? fullscreenEditorRef.current : editorRef.current;
    if (editor) {
      syncScroll(preview, editor);
    }
  }, [isFullscreen, syncScroll]);

  // 键盘快捷键
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const textarea = e.target as HTMLTextAreaElement;
    const { selectionStart, selectionEnd } = textarea;
    
    // Tab键缩进
    if (e.key === 'Tab') {
      e.preventDefault();
      const newValue = value.slice(0, selectionStart) + '  ' + value.slice(selectionEnd);
      onChange(newValue);
      
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
      }, 0);
    }
    
    // Ctrl+B 粗体
    if (e.ctrlKey && e.key === 'b') {
      e.preventDefault();
      insertMarkdown('**', '**', '粗体文本');
    }
    
    // Ctrl+I 斜体
    if (e.ctrlKey && e.key === 'i') {
      e.preventDefault();
      insertMarkdown('*', '*', '斜体文本');
    }
    
    // Ctrl+K 链接
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      insertMarkdown('[', '](https://example.com)', '链接文本');
    }
  };

  // 插入Markdown语法
  const insertMarkdown = (prefix: string, suffix: string, placeholder: string) => {
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    if (!textarea) return;

    const { selectionStart, selectionEnd } = textarea;
    const selectedText = value.slice(selectionStart, selectionEnd);
    const textToInsert = selectedText || placeholder;
    
    const newValue = 
      value.slice(0, selectionStart) + 
      prefix + textToInsert + suffix + 
      value.slice(selectionEnd);
    
    onChange(newValue);
    
    setTimeout(() => {
      const newCursorPos = selectionStart + prefix.length;
      textarea.selectionStart = newCursorPos;
      textarea.selectionEnd = newCursorPos + textToInsert.length;
      textarea.focus();
    }, 0);
  };

  return (
    <>
      {/* 全屏模式覆盖层 */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 bg-white dark:bg-neutral-900">
          <div className="h-full flex flex-col">
            {/* 全屏工具栏 */}
            <div className="bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700 p-2 flex-shrink-0">
              <div className="flex items-center justify-between">
                {/* 视图切换 */}
                <div className="flex space-x-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab('edit')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm rounded ${
                      activeTab === 'edit'
                        ? 'bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900'
                        : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                    }`}
                  >
                    <PencilLine className="h-3.5 w-3.5" />
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('preview')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm rounded ${
                      activeTab === 'preview'
                        ? 'bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900'
                        : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                    }`}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    预览
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('split')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm rounded ${
                      activeTab === 'split'
                        ? 'bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900'
                        : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                    }`}
                  >
                    <Columns2 className="h-3.5 w-3.5" />
                    分屏
                  </button>
                </div>

                {/* 格式工具和退出全屏 */}
                <div className="flex items-center space-x-1">
                  <button
                    type="button"
                    onClick={() => insertMarkdown('**', '**', '粗体文本')}
                    className="px-2 py-1 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded"
                    title="粗体 (Ctrl+B)"
                  >
                    B
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdown('*', '*', '斜体文本')}
                    className="px-2 py-1 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded italic"
                    title="斜体 (Ctrl+I)"
                  >
                    I
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdown('[', '](https://example.com)', '链接文本')}
                    className="px-2 py-1 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded"
                    title="链接 (Ctrl+K)"
                  >
                    <LinkIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => insertMarkdown('```\n', '\n```', 'code')}
                    className="px-2 py-1 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded font-mono"
                    title="代码块"
                  >
                    {'</>'}
                  </button>
                  
                  {/* 分隔线 */}
                  <div className="h-4 w-px bg-neutral-300 dark:bg-neutral-600 mx-2"></div>
                  
                  {/* 同步滚动按钮 */}
                  {activeTab === 'split' && (
                    <button
                      type="button"
                      onClick={() => setIsScrollSync(!isScrollSync)}
                      className={`px-2 py-1 text-sm rounded ${ 
                        isScrollSync
                          ? 'bg-neutral-600 dark:bg-neutral-300 text-neutral-100 dark:text-neutral-700'
                          : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                      }`}
                      title={isScrollSync ? "关闭同步滚动" : "开启同步滚动"}
                    >
                      <ArrowUpDown className="h-4 w-4" />
                    </button>
                  )}
                  
                  {/* 退出全屏按钮 */}
                  <button
                    type="button"
                    onClick={() => setIsFullscreen(false)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-sm bg-neutral-700 dark:bg-neutral-200 text-neutral-200 dark:text-neutral-700 rounded hover:bg-neutral-600 dark:hover:bg-neutral-300 transition-colors"
                    title="退出全屏 (ESC)"
                  >
                    <Minimize2 className="h-3.5 w-3.5" />
                    退出全屏
                  </button>
                </div>
              </div>
            </div>

            {/* 全屏编辑器内容 */}
            <div className="flex flex-1 min-h-0">
              {/* 编辑区域 */}
              {(activeTab === 'edit' || activeTab === 'split') && (
                <div className={`${activeTab === 'split' ? 'w-1/2 border-r border-neutral-200 dark:border-neutral-700' : 'w-full'} flex flex-col`}>
                  <textarea
                    ref={fullscreenEditorRef}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onScroll={handleEditorScroll}
                    placeholder={placeholder}
                    className="w-full h-full p-4 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 font-mono text-sm resize-none focus:outline-none border-none flex-1"
                    spellCheck={false}
                    autoFocus
                  />
                </div>
              )}

              {/* 预览区域 */}
              {(activeTab === 'preview' || activeTab === 'split') && (
                <div className={`${activeTab === 'split' ? 'w-1/2' : 'w-full'} flex flex-col overflow-hidden`}>
                  <div 
                    ref={fullscreenPreviewRef}
                    onScroll={handlePreviewScroll}
                    className="flex-1 overflow-y-auto p-4 bg-white dark:bg-neutral-900"
                  >
                    {isPreviewLoading ? (
                      <div className="flex items-center justify-center h-32">
                        <div className="text-neutral-600 dark:text-neutral-400">
                          正在生成预览...
                        </div>
                      </div>
                    ) : previewHtml ? (
                      <div 
                        className="prose dark:prose-invert max-w-none"
                        dangerouslySetInnerHTML={{ __html: previewHtml }}
                      />
                    ) : (
                      <div className="text-center text-neutral-500 dark:text-neutral-400 mt-8">
                        开始输入内容以查看预览...
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 全屏状态栏 */}
            <div className="bg-neutral-100 dark:bg-neutral-800 border-t border-neutral-200 dark:border-neutral-700 px-4 py-2 text-xs text-neutral-600 dark:text-neutral-400 flex justify-between flex-shrink-0">
              <div>
                {value.length} 字符 | {value.split('\n').length} 行
              </div>
              <div>
                全屏模式 - 按ESC退出 | 快捷键: Ctrl+B(粗体) Ctrl+I(斜体) Ctrl+K(链接) Tab(缩进)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 常规编辑器 */}
      <div className="border border-neutral-200 dark:border-neutral-700 rounded-lg overflow-hidden">
        {/* 工具栏 */}
        <div className="bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700 p-2">
          <div className="flex items-center justify-between">
            {/* 视图切换 */}
            <div className="flex space-x-1">
              <button
                type="button"
                onClick={() => setActiveTab('edit')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm rounded ${
                  activeTab === 'edit'
                    ? 'bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900'
                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                }`}
              >
                <PencilLine className="h-3.5 w-3.5" />
                编辑
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm rounded ${
                  activeTab === 'preview'
                    ? 'bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900'
                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                预览
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('split')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 text-sm rounded ${
                  activeTab === 'split'
                    ? 'bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900'
                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                }`}
              >
                <Columns2 className="h-3.5 w-3.5" />
                分屏
              </button>
            </div>

            {/* 格式工具 */}
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={() => insertMarkdown('**', '**', '粗体文本')}
                className="px-2 py-1 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded"
                title="粗体 (Ctrl+B)"
              >
                B
              </button>
              <button
                type="button"
                onClick={() => insertMarkdown('*', '*', '斜体文本')}
                className="px-2 py-1 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded italic"
                title="斜体 (Ctrl+I)"
              >
                I
              </button>
              <button
                type="button"
                onClick={() => insertMarkdown('[', '](https://example.com)', '链接文本')}
                className="px-2 py-1 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded"
                title="链接 (Ctrl+K)"
              >
                <LinkIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => insertMarkdown('```\n', '\n```', 'code')}
                className="px-2 py-1 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded font-mono"
                title="代码块"
              >
                {'</>'}
              </button>
              
              {/* 分隔线 */}
              <div className="h-4 w-px bg-neutral-300 dark:bg-neutral-600"></div>
              
              {/* 同步滚动按钮 */}
              {activeTab === 'split' && (
                <button
                  type="button"
                  onClick={() => setIsScrollSync(!isScrollSync)}
                  className={`px-2 py-1 text-sm rounded ${
                    isScrollSync
                      ? 'bg-neutral-600 dark:bg-neutral-300 text-neutral-100 dark:text-neutral-700'
                      : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                  }`}
                  title={isScrollSync ? "关闭同步滚动" : "开启同步滚动"}
                >
                  <ArrowUpDown className="h-4 w-4" />
                </button>
              )}
              
              {/* 全屏按钮 */}
              <button
                type="button"
                onClick={() => setIsFullscreen(!isFullscreen)}
                className="px-2 py-1 text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded"
                title={isFullscreen ? "退出全屏 (ESC)" : "全屏编辑"}
              >
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4" />
                ) : (
                  <Maximize2 className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* 编辑器内容 */}
        <div className={`flex ${height}`}>
          {/* 编辑区域 */}
          {(activeTab === 'edit' || activeTab === 'split') && (
            <div className={`${activeTab === 'split' ? 'w-1/2 border-r border-neutral-200 dark:border-neutral-700' : 'w-full'}`}>
              <textarea
                ref={editorRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onScroll={handleEditorScroll}
                placeholder={placeholder}
                className={`w-full h-full p-4 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 font-mono text-sm resize-none focus:outline-none border-none ${height}`}
                spellCheck={false}
              />
            </div>
          )}

          {/* 预览区域 */}
          {(activeTab === 'preview' || activeTab === 'split') && (
            <div 
              ref={previewRef}
              onScroll={handlePreviewScroll}
              className={`${activeTab === 'split' ? 'w-1/2' : 'w-full'} ${height} overflow-y-auto`}
            >
              <div className="p-4 bg-white dark:bg-neutral-900 h-full">
                {isPreviewLoading ? (
                  <div className="flex items-center justify-center h-32">
                    <div className="text-neutral-600 dark:text-neutral-400">
                      正在生成预览...
                    </div>
                  </div>
                ) : previewHtml ? (
                  <div 
                    className="prose dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                ) : (
                  <div className="text-center text-neutral-500 dark:text-neutral-400 mt-8">
                    开始输入内容以查看预览...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 状态栏 */}
        <div className="bg-neutral-100 dark:bg-neutral-800 border-t border-neutral-200 dark:border-neutral-700 px-4 py-2 text-xs text-neutral-600 dark:text-neutral-400 flex justify-between">
          <div>
            {value.length} 字符 | {value.split('\n').length} 行
          </div>
          <div>
            快捷键: Ctrl+B(粗体) Ctrl+I(斜体) Ctrl+K(链接) Tab(缩进)
          </div>
        </div>
      </div>
    </>
  );
}
