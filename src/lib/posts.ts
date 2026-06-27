import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { remark } from 'remark';
import remarkHtml from 'remark-html';
import { rehype } from 'rehype';
import rehypePrismPlus from 'rehype-prism-plus';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import { Post, PostMeta, PostFrontmatter } from '@/types';
import { calculateReadingTime, generateExcerpt } from './utils';
import { decodeSlug } from './slug';

const postsDirectory = path.join(process.cwd(), 'content/posts');

export interface PostFileInfo {
  fileName: string;
  fileSlug: string;
  fullPath: string;
  publicSlug: string;
  frontmatter: PostFrontmatter;
  content: string;
  stats: fs.Stats;
}

function getMarkdownFileNames(): string[] {
  if (!fs.existsSync(postsDirectory)) {
    return [];
  }

  return fs.readdirSync(postsDirectory)
    .filter(fileName => fileName.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b));
}

function getFileSlug(fileName: string): string {
  return fileName.replace(/\.md$/, '');
}

function getPublicSlug(frontmatter: PostFrontmatter, fileSlug: string): string {
  const frontmatterSlug = typeof frontmatter.slug === 'string' ? frontmatter.slug.trim() : '';
  return frontmatterSlug || fileSlug;
}

function readPostFile(fileName: string): PostFileInfo | null {
  try {
    const fileSlug = getFileSlug(fileName);
    const fullPath = path.join(postsDirectory, fileName);
    const fileContents = fs.readFileSync(fullPath, 'utf8');
    const { data, content } = matter(fileContents);
    const frontmatter = data as PostFrontmatter;
    const stats = fs.statSync(fullPath);

    return {
      fileName,
      fileSlug,
      fullPath,
      publicSlug: getPublicSlug(frontmatter, fileSlug),
      frontmatter,
      content,
      stats,
    };
  } catch (error) {
    console.error(`Error reading post file ${fileName}:`, error);
    return null;
  }
}

function resolveDuplicateSlugs(infos: PostFileInfo[]): PostFileInfo[] {
  const seen = new Set<string>();

  return infos.map(info => {
    if (!seen.has(info.publicSlug)) {
      seen.add(info.publicSlug);
      return info;
    }

    const fallbackInfo = {
      ...info,
      publicSlug: info.fileSlug,
    };

    if (seen.has(fallbackInfo.publicSlug)) {
      console.warn(
        `Duplicate post slug "${info.publicSlug}" in ${info.fileName}; keeping duplicate slug`
      );
      return info;
    }

    console.warn(
      `Duplicate post slug "${info.publicSlug}" in ${info.fileName}; using file slug "${info.fileSlug}"`
    );
    seen.add(fallbackInfo.publicSlug);
    return fallbackInfo;
  });
}

export function getAllPostFileInfos(options: { includeDrafts?: boolean } = {}): PostFileInfo[] {
  const infos = getMarkdownFileNames()
    .map(readPostFile)
    .filter((info): info is PostFileInfo => info !== null)
    .filter(info => options.includeDrafts || info.frontmatter.published !== false);

  return resolveDuplicateSlugs(infos);
}

export function getPostFileInfoBySlug(
  slug: string,
  options: { includeDrafts?: boolean } = {}
): PostFileInfo | null {
  const decodedSlug = decodeSlug(slug);
  const infos = getAllPostFileInfos(options);

  return (
    infos.find(info => info.publicSlug === decodedSlug) ??
    infos.find(info => info.fileSlug === decodedSlug) ??
    null
  );
}

function postFromFileInfo(info: PostFileInfo): Post {
  const readingTime = calculateReadingTime(info.content);
  const excerpt = info.frontmatter.description || generateExcerpt(info.content);

  return {
    slug: info.publicSlug,
    title: info.frontmatter.title,
    date: info.frontmatter.date,
    description: info.frontmatter.description,
    content: info.content,
    tags: info.frontmatter.tags || [],
    cover: info.frontmatter.cover,
    excerpt,
    readingTime,
    published: info.frontmatter.published ?? true,
  };
}

export function getAllPostSlugs(): string[] {
  return getAllPostFileInfos().map(info => info.publicSlug);
}

export function getPostBySlug(slug: string): Post | null {
  const info = getPostFileInfoBySlug(slug);
  return info ? postFromFileInfo(info) : null;
}

export function getAllPosts(): PostMeta[] {
  const posts = getAllPostFileInfos()
    .map(info => {
      const post = postFromFileInfo(info);
      // 只返回元数据，不包含内容
      const { content, ...meta } = post;
      return meta;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return posts;
}

export function getPostsByTag(tag: string): PostMeta[] {
  const allPosts = getAllPosts();
  return allPosts.filter(post => 
    post.tags.some(postTag => 
      postTag.toLowerCase() === tag.toLowerCase()
    )
  );
}

export function getAllTags(): { tag: string; count: number }[] {
  const allPosts = getAllPosts();
  const tagCounts: Record<string, number> = {};

  allPosts.forEach(post => {
    post.tags.forEach(tag => {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
  });

  return Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

export function getPaginatedPosts(page: number = 1, limit: number = 6) {
  const allPosts = getAllPosts();
  const totalPosts = allPosts.length;
  const totalPages = Math.ceil(totalPosts / limit);
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  
  const posts = allPosts.slice(startIndex, endIndex);
  
  return {
    posts,
    pagination: {
      currentPage: page,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
}

export async function markdownToHtml(markdown: string): Promise<string> {
  // 首先将 markdown 转换为 HTML
  const remarkResult = await remark()
    .use(remarkHtml, { sanitize: false })
    .process(markdown);
    
  // 然后使用 rehype 处理 HTML，添加代码高亮和标题锚点
  const rehypeResult = await rehype()
    .use(rehypeSlug) // 为标题添加ID
    .use(rehypePrismPlus, {
      showLineNumbers: true,
      ignoreMissing: true,
      // 确保行号功能正确启用
      lineNumbersStyle: true
    })
    .use(rehypeStringify)
    .process(remarkResult.toString());
    
  return rehypeResult.toString();
}
