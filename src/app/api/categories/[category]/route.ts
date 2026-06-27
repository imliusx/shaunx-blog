import { NextRequest, NextResponse } from 'next/server';
import { getPostsByCategory } from '@/lib/posts';
import { decodeSlug } from '@/lib/slug';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface RouteContext {
  params: { category: string };
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  try {
    const category = decodeSlug(params.category);
    const posts = getPostsByCategory(category);

    return NextResponse.json({
      success: true,
      data: {
        category,
        posts,
        count: posts.length,
      },
    });
  } catch (error) {
    console.error(`❌ 获取类别 ${params.category} 下的文章失败:`, error);
    return NextResponse.json(
      {
        success: false,
        error: '获取类别文章失败',
        details: String(error),
      },
      { status: 500 }
    );
  }
}
