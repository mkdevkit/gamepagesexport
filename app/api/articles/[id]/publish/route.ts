import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, Article } from '@/lib/db';
import { loadConfig } from '@/lib/config';
import { copyDirectory, removeDirectory, directoryExists } from '@/lib/file-utils';
import { exportArticle } from '@/lib/export';
import path from 'path';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id);
    const db = getDatabase();
    const config = loadConfig();

    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as Article;
    if (!article) {
      return NextResponse.json({ success: false, error: 'Article not found' }, { status: 404 });
    }

    // 检查文章是否已经是已发布状态
    if (article.flag === 'published') {
      return NextResponse.json({ success: false, error: '文章已经是已发布状态' }, { status: 400 });
    }

    const directory = article.directory;

    // 更新文章状态为已发布
    db.prepare('UPDATE articles SET flag = ?, updated_at = ? WHERE id = ?').run('published', new Date().toISOString(), id);

    // 导出 Astro 文件（包括 md 文件、图片和草稿文件）
    await exportArticle(article.id);

    const updatedArticle = db.prepare('SELECT * FROM articles WHERE id = ?').get(id);

    return NextResponse.json({ success: true, data: updatedArticle });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
