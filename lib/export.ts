import { getDatabase, Article } from '@/lib/db';
import { loadConfig } from '@/lib/config';
import { writeFile, mkdir, copyFile, readdir, stat } from 'fs/promises';
import path from 'path';

export interface ArticleExportData {
  directory: string;
  title_en: string;
  title_zh: string;
  address: string;
  thumbnail: string;
  preview?: string;
  description_en?: string;
  description_zh?: string;
  content?: string;
  src?: string;
  date: string;
  categories: Array<{ name_en: string; name_zh: string }>;
  tags: Array<{ name_en: string; name_zh: string }>;
}

export async function exportArticle(articleId: number) {
  const db = getDatabase();
  const config = loadConfig();

  // 获取文章基本信息
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(articleId) as Article;
  if (!article) {
    throw new Error('Article not found');
  }

  // 检查文章是否为已发布状态
  if (article.flag !== 'published') {
    throw new Error('只能导出已发布的文章');
  }

  // 获取文章的分类
  const categories = db.prepare(`
    SELECT c.name_en, c.name_zh FROM categories c
    INNER JOIN article_categories ac ON c.id = ac.category_id
    WHERE ac.article_id = ?
  `).all(articleId) as Array<{ name_en: string; name_zh: string }>;

  // 获取文章的标签
  const tags = db.prepare(`
    SELECT t.name_en, t.name_zh FROM tags t
    INNER JOIN article_tags at ON t.id = at.tag_id
    WHERE at.article_id = ?
  `).all(articleId) as Array<{ name_en: string; name_zh: string }>;

  const exportData: ArticleExportData = {
    directory: article.directory,
    title_en: article.title_en,
    title_zh: article.title_zh,
    address: article.address,
    thumbnail: article.thumbnail,
    preview: article.preview,
    description_en: article.description_en,
    description_zh: article.description_zh,
    content: article.content,
    src: article.src,
    date: article.date,
    categories,
    tags,
  };

  // 生成 frontmatter
  const frontmatter = generateFrontmatter(exportData, article.content || '');

  // 确保导出目录存在
  const exportDir = path.join(config.astro_export_dir, article.directory);
  await mkdir(exportDir, { recursive: true });

  // 写入 md 文件
  const mdFilePath = path.join(exportDir, 'index.md');
  await writeFile(mdFilePath, frontmatter, 'utf-8');

  // 复制草稿目录中的所有文件到 draft_files_export_dir
  const draftDir = path.join(config.draft_root_dir, article.directory);
  const draftFilesExportDir = path.join(config.draft_files_export_dir, article.directory);
  await copyAllDraftFiles(draftDir, draftFilesExportDir);

  return { success: true, path: mdFilePath };
}

function generateFrontmatter(data: ArticleExportData, content: string = ''): string {
  // 手动构建 frontmatter，确保 categories 和 tags 使用 JSON 数组格式
  let frontmatter = `---
title:
  en: "${data.title_en}"
  zh-CN: "${data.title_zh}"
address: ${data.address}
thumbnail: "${data.thumbnail}"
`;

  if (data.preview) {
    frontmatter += `preview: "${data.preview}"\n`;
  }

  if (data.description_en || data.description_zh) {
    frontmatter += `description:\n`;
    if (data.description_en) {
      frontmatter += `  en: "${data.description_en}"\n`;
    }
    if (data.description_zh) {
      frontmatter += `  zh-CN: "${data.description_zh}"\n`;
    }
  }

  if (data.categories && data.categories.length > 0) {
    const categories = data.categories.map((c) => `"${c.name_en}"`).join(', ');
    frontmatter += `categories: [${categories}]\n`;
  } else {
    frontmatter += `categories: []\n`;
  }

  if (data.tags && data.tags.length > 0) {
    const tags = data.tags.map((t) => `"${t.name_en}"`).join(', ');
    frontmatter += `tags: [${tags}]\n`;
  } else {
    frontmatter += `tags: []\n`;
  }

  if (data.src) {
    frontmatter += `src: "${data.src}"\n`;
  }

  frontmatter += `date: ${data.date.split('T')[0]}
---

${content}`;

  return frontmatter;
}

async function copyImages(sourceDir: string, targetDir: string) {
  try {
    // 检查源目录是否存在
    const sourceStat = await stat(sourceDir).catch(() => null);
    if (!sourceStat || !sourceStat.isDirectory()) {
      return;
    }

    // 读取源目录中的所有文件
    const files = await readdir(sourceDir);

    for (const file of files) {
      const sourcePath = path.join(sourceDir, file);
      const targetPath = path.join(targetDir, file);

      // 检查是否是文件（只复制文件，不复制子目录）
      const fileStat = await stat(sourcePath);

      if (fileStat.isFile()) {
        // 只复制图片文件
        if (/\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(file)) {
          await copyFile(sourcePath, targetPath);
        }
      }
    }
  } catch (error) {
    console.error('Copy images error:', error);
  }
}

async function copyAllDraftFiles(sourceDir: string, targetDir: string) {
  try {
    // 检查源目录是否存在
    const sourceStat = await stat(sourceDir).catch(() => null);
    if (!sourceStat || !sourceStat.isDirectory()) {
      return;
    }

    // 确保目标目录存在
    await mkdir(targetDir, { recursive: true });

    // 读取源目录中的所有文件
    const files = await readdir(sourceDir);

    for (const file of files) {
      const sourcePath = path.join(sourceDir, file);
      const targetPath = path.join(targetDir, file);

      // 检查是否是文件
      const fileStat = await stat(sourcePath);

      if (fileStat.isFile()) {
        // 复制所有文件（不限制文件类型）
        await copyFile(sourcePath, targetPath);
      }
    }
  } catch (error) {
    console.error('Copy draft files error:', error);
  }
}

export async function exportAllArticles() {
  const db = getDatabase();

  // 获取所有已发布的文章
  const articles = db.prepare("SELECT id FROM articles WHERE flag = 'published'").all() as Array<{ id: number }>;

  const results = [];

  for (const article of articles) {
    try {
      // 导出 md 文件（exportArticle 内部会自动复制图片）
      const result = await exportArticle(article.id);
      results.push(result);
    } catch (error) {
      console.error(`Failed to export article ${article.id}:`, error);
      results.push({ success: false, articleId: article.id, error: (error as Error).message });
    }
  }

  return {
    success: true,
    total: articles.length,
    exported: results.filter((r: any) => r.success).length,
    failed: results.filter((r: any) => !r.success).length,
    results,
  };
}
