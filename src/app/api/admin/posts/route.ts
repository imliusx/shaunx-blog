import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware';
import { getAllPostFileInfos, getPostFileInfoBySlug } from '@/lib/posts';
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

// 获取所有文章（包括草稿）- 管理员视图
const handleGetPosts = withAdminAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const includeContent = searchParams.get('includeContent') === 'true';
    const filterTag = searchParams.get('tag');

    let posts = getAllPostFileInfos({ includeDrafts: true }).map(info => ({
      slug: info.publicSlug,
      title: info.frontmatter.title,
      date: info.frontmatter.date,
      category: info.frontmatter.category,
      published: info.frontmatter.published ?? true,
      tags: info.frontmatter.tags || [],
      description: info.frontmatter.description,
      cover: info.frontmatter.cover,
      content: includeContent ? info.content : undefined,
      createdAt: info.stats.birthtime.toISOString(),
      updatedAt: info.stats.mtime.toISOString(),
    }));

    // 按标签筛选
    if (filterTag && filterTag.trim() !== '') {
      posts = posts.filter(post => 
        post.tags && post.tags.some((tag: string) => 
          tag.toLowerCase() === filterTag.toLowerCase()
        )
      );
    }

    // 按日期排序
    posts = posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return NextResponse.json({
      success: true,
      data: posts
    });

  } catch (error) {
    console.error('获取管理员文章列表失败:', error);
    return NextResponse.json(
      { success: false, error: '获取文章列表失败' },
      { status: 500 }
    );
  }
});

// 创建新文章
const handleCreatePost = withAdminAuth(async (request: NextRequest) => {
  try {
    const body = await request.json();
    const { slug, title, content, date, category, tags = [], description, cover, published = true } = body;
    const publicSlug = typeof slug === 'string' ? slug.trim() : '';

    if (!publicSlug || !title || !content) {
      return NextResponse.json(
        { success: false, error: 'slug, title, content 是必填字段' },
        { status: 400 }
      );
    }

    // 检查slug是否已存在
    const postsDirectory = path.join(process.cwd(), 'content/posts');
    const filePath = path.join(postsDirectory, `${publicSlug}.md`);
    
    if (fs.existsSync(filePath) || getPostFileInfoBySlug(publicSlug, { includeDrafts: true })) {
      return NextResponse.json(
        { success: false, error: '该文章slug已存在' },
        { status: 409 }
      );
    }

    // 确保目录存在
    if (!fs.existsSync(postsDirectory)) {
      fs.mkdirSync(postsDirectory, { recursive: true });
    }

    // 构建frontmatter
    const frontmatter = {
      slug: publicSlug,
      title,
      date: date || new Date().toISOString().split('T')[0],
      ...(category && { category }),
      ...(tags.length > 0 && { tags }),
      ...(description && { description }),
      ...(cover && { cover }),
      published,
    };

    // 生成markdown内容
    const fileContent = matter.stringify(content, frontmatter);

    // 写入文件
    fs.writeFileSync(filePath, fileContent, 'utf8');

    return NextResponse.json({
      success: true,
      message: '文章创建成功',
      data: { slug: publicSlug }
    });

  } catch (error) {
    console.error('创建文章失败:', error);
    return NextResponse.json(
      { success: false, error: '创建文章失败' },
      { status: 500 }
    );
  }
});

export const GET = handleGetPosts;
export const POST = handleCreatePost;
