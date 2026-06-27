'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Tag } from 'lucide-react';

interface Tag {
  tag: string;
  count: number;
}

interface TagFilterProps {
  selectedTag: string;
  onTagChange: (tag: string) => void;
  className?: string;
}

export function TagFilter({ selectedTag, onTagChange, className = "" }: TagFilterProps) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    fetchTags();
  }, []);

  const fetchTags = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/tags');
      const data = await response.json();
      
      if (data.success) {
        setTags(data.data);
      }
    } catch (error) {
      console.error('获取标签列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTagSelect = (tag: string) => {
    onTagChange(tag);
    setShowDropdown(false);
  };

  const currentTagDisplay = selectedTag === '' ? 'All Tags' : 
    tags.find(t => t.tag === selectedTag)?.tag || selectedTag;

  const currentTagCount = selectedTag === '' ? 
    tags.reduce((sum, tag) => sum + tag.count, 0) :
    tags.find(t => t.tag === selectedTag)?.count || 0;

  return (
    <div className={`relative ${className}`}>
      {/* 标签选择器 */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        disabled={loading}
        className="flex items-center space-x-2 px-4 py-2 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-mono text-sm min-w-48"
      >
        <Tag className="h-4 w-4 text-neutral-600 dark:text-neutral-400" />
        <span className="text-neutral-900 dark:text-neutral-100 flex-1 text-left">
          {loading ? 'Loading...' : `[${currentTagDisplay}]`}
        </span>
        {!loading && (
          <span className="text-neutral-500 dark:text-neutral-400 text-xs">
            ({currentTagCount})
          </span>
        )}
        {showDropdown ? (
          <ChevronUp className="h-4 w-4 text-neutral-600 dark:text-neutral-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-neutral-600 dark:text-neutral-400" />
        )}
      </button>

      {/* 下拉菜单 */}
      {showDropdown && !loading && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded shadow-lg z-10 max-h-60 overflow-y-auto">
          {/* 全部选项 */}
          <button
            onClick={() => handleTagSelect('')}
            className={`w-full text-left px-4 py-2 text-sm font-mono transition-colors ${
              selectedTag === ''
                ? 'bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900'
                : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
            }`}
          >
            <div className="flex justify-between items-center">
              <span>[All Tags]</span>
              <span className="text-neutral-500 dark:text-neutral-400 text-xs">
                ({tags.reduce((sum, tag) => sum + tag.count, 0)})
              </span>
            </div>
          </button>

          {/* 分隔线 */}
          <div className="border-t border-neutral-200 dark:border-neutral-700 mx-2"></div>

          {/* 标签列表 */}
          {tags.map((tag) => (
            <button
              key={tag.tag}
              onClick={() => handleTagSelect(tag.tag)}
              className={`w-full text-left px-4 py-2 text-sm font-mono transition-colors ${
                selectedTag === tag.tag
                  ? 'bg-neutral-900 dark:bg-neutral-100 text-neutral-100 dark:text-neutral-900'
                  : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
              }`}
            >
              <div className="flex justify-between items-center">
                <span>[{tag.tag}]</span>
                <span className="text-neutral-500 dark:text-neutral-400 text-xs">
                  ({tag.count})
                </span>
              </div>
            </button>
          ))}

          {tags.length === 0 && (
            <div className="px-4 py-2 text-sm text-neutral-500 dark:text-neutral-400 font-mono">
              No tags found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
