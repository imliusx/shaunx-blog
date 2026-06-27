import { NextRequest, NextResponse } from 'next/server';
import { getAllCategories, getPostsByCategory } from '@/lib/posts';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');

    if (category) {
      const posts = getPostsByCategory(category);
      return NextResponse.json({
        success: true,
        data: {
          category,
          posts,
          count: posts.length,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: getAllCategories(),
    });
  } catch (error) {
    console.error('❌ 获取类别失败:', error);
    return NextResponse.json(
      {
        success: false,
        error: '获取类别失败',
        details: String(error),
      },
      { status: 500 }
    );
  }
}
