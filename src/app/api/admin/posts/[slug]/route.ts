import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/middleware';
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { decodeSlug } from '@/lib/slug';
import { getPostFileInfoBySlug } from '@/lib/posts';

// 获取单篇文章（管理员视图，包括草稿）
const handleGetPost = withAdminAuth(async (request: NextRequest, { params }: { params: { slug: string } }) => {
  try {
    const slug = decodeSlug(params.slug);
    const postInfo = getPostFileInfoBySlug(slug, { includeDrafts: true });

    if (!postInfo) {
      return NextResponse.json(
        { success: false, error: '文章不存在' },
        { status: 404 }
      );
    }
    
    const post = {
      slug: postInfo.publicSlug,
      title: postInfo.frontmatter.title,
      date: postInfo.frontmatter.date,
      category: postInfo.frontmatter.category,
      published: postInfo.frontmatter.published ?? true,
      tags: postInfo.frontmatter.tags || [],
      description: postInfo.frontmatter.description,
      cover: postInfo.frontmatter.cover,
      content: postInfo.content,
      createdAt: postInfo.stats.birthtime.toISOString(),
      updatedAt: postInfo.stats.mtime.toISOString(),
    };

    return NextResponse.json({
      success: true,
      data: post
    });

  } catch (error) {
    console.error('获取管理员文章失败:', error);
    return NextResponse.json(
      { success: false, error: '获取文章失败' },
      { status: 500 }
    );
  }
});

// 更新文章
const handleUpdatePost = withAdminAuth(async (request: NextRequest, { params }: { params: { slug: string } }) => {
  try {
    const slug = decodeSlug(params.slug);
    const body = await request.json();
    const { title, content, date, category, tags = [], description, cover, published = true, newSlug } = body;

    const postInfo = getPostFileInfoBySlug(slug, { includeDrafts: true });
    const nextSlug = typeof newSlug === 'string' && newSlug.trim() ? newSlug.trim() : slug;

    if (!postInfo) {
      return NextResponse.json(
        { success: false, error: '文章不存在' },
        { status: 404 }
      );
    }

    // 如果要修改slug
    if (nextSlug !== slug) {
      const existingPost = getPostFileInfoBySlug(nextSlug, { includeDrafts: true });
      if (existingPost && existingPost.fullPath !== postInfo.fullPath) {
        return NextResponse.json(
          { success: false, error: '新的slug已存在' },
          { status: 409 }
        );
      }

      const postsDirectory = path.dirname(postInfo.fullPath);
      const newFilePath = path.join(postsDirectory, `${nextSlug}.md`);
      if (fs.existsSync(newFilePath) && newFilePath !== postInfo.fullPath) {
        return NextResponse.json(
          { success: false, error: '新的slug已存在' },
          { status: 409 }
        );
      }
    }

    // 构建frontmatter
    const frontmatter = {
      slug: nextSlug,
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

    // 如果修改了slug，先删除旧文件
    if (nextSlug !== slug) {
      const postsDirectory = path.dirname(postInfo.fullPath);
      const newFilePath = path.join(postsDirectory, `${nextSlug}.md`);
      fs.writeFileSync(newFilePath, fileContent, 'utf8');
      fs.unlinkSync(postInfo.fullPath);
    } else {
      fs.writeFileSync(postInfo.fullPath, fileContent, 'utf8');
    }

    return NextResponse.json({
      success: true,
      message: '文章更新成功',
      data: { slug: nextSlug }
    });

  } catch (error) {
    console.error('更新文章失败:', error);
    return NextResponse.json(
      { success: false, error: '更新文章失败' },
      { status: 500 }
    );
  }
});

// 删除文章
const handleDeletePost = withAdminAuth(async (request: NextRequest, { params }: { params: { slug: string } }) => {
  try {
    const slug = decodeSlug(params.slug);
    const postInfo = getPostFileInfoBySlug(slug, { includeDrafts: true });

    if (!postInfo) {
      return NextResponse.json(
        { success: false, error: '文章不存在' },
        { status: 404 }
      );
    }

    fs.unlinkSync(postInfo.fullPath);

    return NextResponse.json({
      success: true,
      message: '文章删除成功'
    });

  } catch (error) {
    console.error('删除文章失败:', error);
    return NextResponse.json(
      { success: false, error: '删除文章失败' },
      { status: 500 }
    );
  }
});

export const GET = handleGetPost;
export const PUT = handleUpdatePost;
export const DELETE = handleDeletePost;
