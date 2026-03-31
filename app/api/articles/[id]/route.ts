import { NextRequest, NextResponse } from 'next/server';
import { getDatabase, Article, Category, Tag } from '@/lib/db';
import { ArticleWithRelations } from '@/types';
import { loadConfig } from '@/lib/config';
import { removeDirectory, directoryExists } from '@/lib/file-utils';
import { exportArticle } from '@/lib/export';
import path from 'path';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id);
    const db = getDatabase();

    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as ArticleWithRelations;

    if (!article) {
      return NextResponse.json({ success: false, error: 'Article not found' }, { status: 404 });
    }

    article.categories = db.prepare(`
      SELECT c.* FROM categories c
      INNER JOIN article_categories ac ON c.id = ac.category_id
      WHERE ac.article_id = ?
    `).all(id) as Category[];

    article.tags = db.prepare(`
      SELECT t.* FROM tags t
      INNER JOIN article_tags at ON t.id = at.tag_id
      WHERE at.article_id = ?
    `).all(id) as Tag[];

    return NextResponse.json({ success: true, data: article });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id);
    const body = await request.json();
    const {
      directory,
      title_en,
      title_zh,
      address,
      thumbnail,
      preview,
      description_en,
      description_zh,
      content,
      src,
      categories,
      tags,
      flag,
    } = body;

    const db = getDatabase();

    const existingArticle = db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as Article;
    if (!existingArticle) {
      return NextResponse.json({ success: false, error: 'Article not found' }, { status: 404 });
    }

    const updateFields: string[] = [];
    const updateParams: any[] = [];

    if (directory !== undefined) {
      updateFields.push('directory = ?');
      updateParams.push(directory);
    }
    if (title_en !== undefined) {
      updateFields.push('title_en = ?');
      updateParams.push(title_en);
    }
    if (title_zh !== undefined) {
      updateFields.push('title_zh = ?');
      updateParams.push(title_zh);
    }
    if (address !== undefined) {
      updateFields.push('address = ?');
      updateParams.push(address);
    }
    if (thumbnail !== undefined) {
      updateFields.push('thumbnail = ?');
      updateParams.push(thumbnail);
    }
    if (preview !== undefined) {
      updateFields.push('preview = ?');
      updateParams.push(preview || null);
    }
    if (description_en !== undefined) {
      updateFields.push('description_en = ?');
      updateParams.push(description_en || null);
    }
    if (description_zh !== undefined) {
      updateFields.push('description_zh = ?');
      updateParams.push(description_zh || null);
    }
    if (content !== undefined) {
      updateFields.push('content = ?');
      updateParams.push(content || null);
    }
    if (src !== undefined) {
      updateFields.push('src = ?');
      updateParams.push(src || null);
    }
    if (flag !== undefined) {
      updateFields.push('flag = ?');
      updateParams.push(flag);
    }

    if (updateFields.length > 0) {
      updateFields.push('updated_at = ?');
      updateParams.push(new Date().toISOString());
      updateParams.push(id);

      db.prepare(`UPDATE articles SET ${updateFields.join(', ')} WHERE id = ?`).run(...updateParams);
    }

    // 更新分类关联
    if (categories !== undefined) {
      db.prepare('DELETE FROM article_categories WHERE article_id = ?').run(id);
      const insertCategory = db.prepare('INSERT INTO article_categories (article_id, category_id) VALUES (?, ?)');
      for (const categoryId of categories) {
        insertCategory.run(id, categoryId);
      }
    }

    // 更新标签关联
    if (tags !== undefined) {
      db.prepare('DELETE FROM article_tags WHERE article_id = ?').run(id);
      const insertTag = db.prepare('INSERT INTO article_tags (article_id, tag_id) VALUES (?, ?)');
      for (const tagId of tags) {
        insertTag.run(id, tagId);
      }
    }

    // 如果文章是已发布状态，重新导出
    const updatedArticle = db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as Article;
    if (updatedArticle && updatedArticle.flag === 'published') {
      try {
        await exportArticle(id);
      } catch (error) {
        console.error('Export failed:', error);
        // 导出失败不影响更新操作
      }
    }

    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as ArticleWithRelations;
    article.categories = db.prepare(`
      SELECT c.* FROM categories c
      INNER JOIN article_categories ac ON c.id = ac.category_id
      WHERE ac.article_id = ?
    `).all(id) as Category[];

    article.tags = db.prepare(`
      SELECT t.* FROM tags t
      INNER JOIN article_tags at ON t.id = at.tag_id
      WHERE at.article_id = ?
    `).all(id) as Tag[];

    return NextResponse.json({ success: true, data: article });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const id = parseInt(params.id);
    const db = getDatabase();
    const config = loadConfig();

    // 先获取文章信息，以便删除相关目录
    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(id) as Article;
    if (!article) {
      return NextResponse.json({ success: false, error: 'Article not found' }, { status: 404 });
    }

    const directory = article.directory;
    const draftDir = path.join(config.draft_root_dir, directory);
    const exportDir = path.join(config.astro_export_dir, directory);
    const draftFilesExportDir = path.join(config.draft_files_export_dir, directory);

    // 删除数据库中的文章
    const result = db.prepare('DELETE FROM articles WHERE id = ?').run(id);

    if (result.changes === 0) {
      return NextResponse.json({ success: false, error: 'Article not found' }, { status: 404 });
    }

    // 删除草稿目录
    if (await directoryExists(draftDir)) {
      await removeDirectory(draftDir);
    }

    // 删除导出目录
    if (await directoryExists(exportDir)) {
      await removeDirectory(exportDir);
    }

    // 删除草稿文件导出目录
    if (await directoryExists(draftFilesExportDir)) {
      await removeDirectory(draftFilesExportDir);
    }

    return NextResponse.json({ success: true, message: 'Article deleted successfully' });
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message }, { status: 500 });
  }
}
