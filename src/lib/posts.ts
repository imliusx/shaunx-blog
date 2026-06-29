import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';
import { rehype } from 'rehype';
import rehypePrismPlus from 'rehype-prism-plus';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import { Post, PostMeta, PostFrontmatter } from '@/types';
import { calculateReadingTime, generateExcerpt } from './utils';
import { decodeSlug } from './slug';
import { POST_CATEGORIES, normalizeCategory } from './categories';
import { normalizeMarkdownImageUrl, normalizeRemarkImages } from './markdown-images';

const postsDirectory = path.join(process.cwd(), 'content/posts');

interface HastNode {
  type?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
}

function rehypeWrapTables() {
  return (tree: HastNode) => {
    const wrapTables = (node: HastNode) => {
      if (!node.children) return;

      node.children = node.children.map((child) => {
        if (child.type === 'element' && child.tagName === 'table') {
          return {
            type: 'element',
            tagName: 'div',
            properties: { className: ['table-scroll'] },
            children: [child],
          };
        }

        wrapTables(child);
        return child;
      });
    };

    wrapTables(tree);
  };
}

interface LinkPreviewMetadata {
  url: string;
  displayUrl: string;
  title: string;
  description?: string;
  image?: string;
  favicon?: string;
}

const linkPreviewCache = new Map<string, Promise<LinkPreviewMetadata>>();

function getStringProperty(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function isPublicHttpUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return false;

    const hostname = parsedUrl.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.local') ||
      hostname.startsWith('127.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname === '0.0.0.0'
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function parseAttributes(markup: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attributePattern = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(markup)) !== null) {
    attributes[match[1].toLowerCase()] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }

  return attributes;
}

function getMetaContent(html: string, keys: string[]): string | undefined {
  const metaPattern = /<meta\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaPattern.exec(html)) !== null) {
    const attributes = parseAttributes(match[1]);
    const key = attributes.property || attributes.name || attributes.itemprop;

    if (key && keys.includes(key.toLowerCase()) && attributes.content) {
      return attributes.content;
    }
  }

  return undefined;
}

function getTitleContent(html: string): string | undefined {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return titleMatch ? decodeHtmlEntities(titleMatch[1].replace(/\s+/g, ' ')) : undefined;
}

function getFaviconUrl(html: string, pageUrl: string): string | undefined {
  const linkPattern = /<link\b([^>]*)>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkPattern.exec(html)) !== null) {
    const attributes = parseAttributes(match[1]);
    const rel = attributes.rel?.toLowerCase();

    if (rel?.includes('icon') && attributes.href) {
      return new URL(attributes.href, pageUrl).toString();
    }
  }

  return undefined;
}

async function fetchWithTimeout(url: string, timeoutMs = 3500): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ShaunxBlogLinkPreview/1.0)',
      },
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getLinkPreviewMetadata(url: string, fallbackTitle?: string): Promise<LinkPreviewMetadata> {
  if (linkPreviewCache.has(url)) {
    return linkPreviewCache.get(url)!;
  }

  const metadataPromise = (async () => {
    const parsedUrl = new URL(url);
    const displayUrl = `${parsedUrl.hostname}${parsedUrl.pathname === '/' ? '' : parsedUrl.pathname}`;
    const fallbackMetadata = {
      url,
      displayUrl,
      title: fallbackTitle && fallbackTitle !== url ? fallbackTitle : displayUrl,
    };

    try {
      const response = await fetchWithTimeout(url);
      const contentType = response.headers.get('content-type') || '';

      if (!response.ok || !contentType.includes('text/html')) {
        return fallbackMetadata;
      }

      const html = (await response.text()).slice(0, 200_000);
      const title =
        getMetaContent(html, ['og:title', 'twitter:title']) ||
        getTitleContent(html) ||
        fallbackMetadata.title;
      const description = getMetaContent(html, ['og:description', 'twitter:description', 'description']);
      const image = getMetaContent(html, ['og:image', 'twitter:image']);
      const favicon = getFaviconUrl(html, url) || new URL('/favicon.ico', url).toString();

      return {
        ...fallbackMetadata,
        title,
        description,
        image: image ? new URL(image, url).toString() : undefined,
        favicon,
      };
    } catch {
      return fallbackMetadata;
    }
  })();

  linkPreviewCache.set(url, metadataPromise);
  return metadataPromise;
}

function isWhitespaceTextNode(node: HastNode): boolean {
  return node.type === 'text' && !node.value?.trim();
}

function getStandaloneLink(node: HastNode): HastNode | null {
  if (node.type !== 'element' || node.tagName !== 'p' || !node.children) return null;

  const meaningfulChildren = node.children.filter(child => !isWhitespaceTextNode(child));
  if (meaningfulChildren.length !== 1) return null;

  const [child] = meaningfulChildren;
  if (child.type !== 'element' || child.tagName !== 'a') return null;

  const href = getStringProperty(child.properties?.href);
  return href && isPublicHttpUrl(href) ? child : null;
}

function getNodeText(node: HastNode): string {
  if (node.type === 'text') return node.value || '';
  return node.children?.map(getNodeText).join('') || '';
}

function createTextNode(value: string): HastNode {
  return { type: 'text', value };
}

function createLinkPreviewNode(metadata: LinkPreviewMetadata): HastNode {
  const children: HastNode[] = [
    {
      type: 'element',
      tagName: 'div',
      properties: { className: ['link-preview-content'] },
      children: [
        {
          type: 'element',
          tagName: 'div',
          properties: { className: ['link-preview-title'] },
          children: [createTextNode(metadata.title)],
        },
        ...(metadata.description
          ? [{
              type: 'element',
              tagName: 'p',
              properties: { className: ['link-preview-description'] },
              children: [createTextNode(metadata.description)],
            } as HastNode]
          : []),
        {
          type: 'element',
          tagName: 'div',
          properties: { className: ['link-preview-url'] },
          children: [
            ...(metadata.favicon
              ? [{
                  type: 'element',
                  tagName: 'img',
                  properties: {
                    className: ['link-preview-favicon'],
                    src: metadata.favicon,
                    alt: '',
                    loading: 'lazy',
                  },
                  children: [],
                } as HastNode]
              : []),
            {
              type: 'element',
              tagName: 'span',
              children: [createTextNode(metadata.displayUrl)],
            },
          ],
        },
      ],
    },
  ];

  if (metadata.image) {
    children.push({
      type: 'element',
      tagName: 'div',
      properties: { className: ['link-preview-media'] },
      children: [{
        type: 'element',
        tagName: 'img',
        properties: {
          src: metadata.image,
          alt: '',
          loading: 'lazy',
        },
        children: [],
      }],
    });
  }

  return {
    type: 'element',
    tagName: 'a',
    properties: {
      className: ['link-preview-card', 'no-link-underline'],
      href: metadata.url,
      target: '_blank',
      rel: 'noopener noreferrer',
    },
    children,
  };
}

function rehypeLinkPreviews() {
  return async (tree: HastNode) => {
    const transform = async (node: HastNode): Promise<void> => {
      if (!node.children) return;

      const nextChildren: HastNode[] = [];

      for (const child of node.children) {
        const standaloneLink = getStandaloneLink(child);

        if (standaloneLink) {
          const href = getStringProperty(standaloneLink.properties?.href)!;
          const metadata = await getLinkPreviewMetadata(href, getNodeText(standaloneLink));
          nextChildren.push(createLinkPreviewNode(metadata));
          continue;
        }

        await transform(child);
        nextChildren.push(child);
      }

      node.children = nextChildren;
    };

    await transform(tree);
  };
}

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
    category: normalizeCategory(info.frontmatter.category),
    description: info.frontmatter.description,
    content: info.content,
    tags: info.frontmatter.tags || [],
    cover: info.frontmatter.cover ? normalizeMarkdownImageUrl(info.frontmatter.cover) : undefined,
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

export function getPostsByCategory(category: string): PostMeta[] {
  const normalizedCategory = decodeSlug(category).toLowerCase();
  return getAllPosts().filter(post =>
    post.category?.toLowerCase() === normalizedCategory
  );
}

export function getAllCategories(): { category: string; count: number }[] {
  const allPosts = getAllPosts();
  return POST_CATEGORIES.map(category => ({
    category,
    count: allPosts.filter(post => post.category === category).length,
  }));
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
    .use(normalizeRemarkImages)
    .use(remarkGfm)
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
    .use(rehypeWrapTables)
    .use(rehypeLinkPreviews)
    .use(rehypeStringify)
    .process(remarkResult.toString());
    
  return rehypeResult.toString();
}
