import axios from 'axios';
import * as cheerio from 'cheerio';
import { db } from '../db';
import { marketNews, marketNewsEmbeddings } from '@shared/schema';
import { eq, sql, lt } from 'drizzle-orm';
import { generateEmbedding } from './embeddings';

const DEFAULT_QUERIES = [
  'LEGO set retirement announcements',
  'LEGO reseller market news pricing trends',
  'BrickLink marketplace updates sellers',
  'LEGO collectible investing value 2026',
  'LEGO supply chain new releases',
];

interface NewsArticle {
  query: string;
  title: string;
  snippet: string;
  url: string;
  source: string;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return '';
  }
}

async function searchBrave(query: string, limit: number = 5): Promise<Array<{ title: string; snippet: string; url: string }>> {
  const results: Array<{ title: string; snippet: string; url: string }> = [];
  try {
    const response = await axios.get('https://search.brave.com/search', {
      params: { q: query },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);

    $('.snippet[data-type="web"]').each((index, element) => {
      if (index >= limit) return false;
      const $elem = $(element);

      const url = $elem.find('a[href^="http"]').first().attr('href') || '';
      const title = $elem.find('.search-snippet-title').first().text().trim();
      const desc = $elem.find('.content').first().text().trim();

      if (title && url && !url.includes('brave.com') && !url.includes('search.brave')) {
        results.push({ title, snippet: desc || 'No description available', url });
      }
    });
  } catch (err: any) {
    console.error(`[MarketNews] Brave search error for "${query}":`, err.message);
  }
  return results;
}

async function searchDuckDuckGo(query: string, limit: number = 5): Promise<Array<{ title: string; snippet: string; url: string }>> {
  const results: Array<{ title: string; snippet: string; url: string }> = [];
  try {
    const response = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: query },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 15000,
    });

    const $ = cheerio.load(response.data);

    $('.result').each((index, element) => {
      if (index >= limit) return false;
      const $elem = $(element);
      const titleLink = $elem.find('.result__a');
      const title = titleLink.text().trim();
      let rawUrl = titleLink.attr('href') || '';

      let url = '';
      if (rawUrl.includes('uddg=')) {
        try {
          const urlParams = new URLSearchParams(rawUrl.split('?')[1] || '');
          const uddg = urlParams.get('uddg');
          if (uddg) url = decodeURIComponent(uddg);
        } catch { /* skip */ }
      } else {
        url = rawUrl;
      }

      if (url && !url.startsWith('http')) {
        url = 'https://' + url.replace(/^\/+/, '');
      }

      let snippet = $elem.find('.result__snippet').text().trim();
      if (!snippet) snippet = $elem.find('.result__snippet span').text().trim();
      if (!snippet) snippet = $elem.find('.result__extras').text().trim();

      if (title && url && url.startsWith('http') && !url.includes('duckduckgo.com')) {
        results.push({ title, snippet: snippet || 'No description available', url });
      }
    });
  } catch (err: any) {
    console.error(`[MarketNews] DuckDuckGo search error for "${query}":`, err.message);
  }
  return results;
}

export async function fetchMarketNews(queries: string[]): Promise<NewsArticle[]> {
  const articles: NewsArticle[] = [];
  const seenUrls = new Set<string>();
  let braveBlocked = false;

  for (let qi = 0; qi < queries.length; qi++) {
    const query = queries[qi];
    let searchResults: Array<{ title: string; snippet: string; url: string }> = [];

    if (!braveBlocked) {
      searchResults = await searchBrave(query, 5);
      if (searchResults.length === 0) {
        console.log(`[MarketNews] Brave returned 0 results for "${query}", switching to DuckDuckGo for remaining queries`);
        braveBlocked = true;
      }
    }

    if (searchResults.length === 0) {
      searchResults = await searchDuckDuckGo(query, 5);
    }

    for (const r of searchResults) {
      if (seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);

      articles.push({
        query,
        title: r.title,
        snippet: r.snippet,
        url: r.url,
        source: extractDomain(r.url),
      });
    }

    if (qi < queries.length - 1) {
      const delay = braveBlocked ? 2000 : 3000;
      await new Promise(r => setTimeout(r, delay));
    }
  }

  console.log(`[MarketNews] Fetched ${articles.length} articles from ${queries.length} queries`);
  return articles;
}

export async function saveMarketNews(articles: NewsArticle[]): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;

  for (const article of articles) {
    try {
      const existing = await db.execute(sql`
        SELECT id FROM market_news WHERE url = ${article.url} LIMIT 1
      `);

      if (existing.rows.length > 0) {
        await db.execute(sql`
          UPDATE market_news
          SET title = ${article.title},
              snippet = ${article.snippet},
              source = ${article.source},
              fetched_at = NOW(),
              updated_at = NOW()
          WHERE url = ${article.url}
        `);
        updated++;
      } else {
        await db.insert(marketNews).values({
          query: article.query,
          title: article.title,
          snippet: article.snippet,
          url: article.url,
          source: article.source,
          fetchedAt: new Date(),
        });
        added++;
      }
    } catch (err: any) {
      console.error(`[MarketNews] Error saving article "${article.title}":`, err.message);
    }
  }

  return { added, updated };
}

export async function generateMarketNewsEmbeddings(): Promise<number> {
  try {
    const unembedded = await db.execute(sql`
      SELECT mn.id, mn.title, mn.snippet, mn.source, mn.query, mn.fetched_at
      FROM market_news mn
      LEFT JOIN market_news_embeddings mne ON mn.id = mne.article_id
      WHERE mne.article_id IS NULL
      ORDER BY mn.fetched_at DESC
      LIMIT 50
    `);

    if (unembedded.rows.length === 0) return 0;

    console.log(`[MarketNews] Generating embeddings for ${unembedded.rows.length} articles...`);

    let count = 0;
    for (const row of unembedded.rows as any[]) {
      try {
        const content = [
          `Market News: ${row.title}`,
          row.snippet ? `Summary: ${row.snippet}` : '',
          row.source ? `Source: ${row.source}` : '',
          `Topic: ${row.query}`,
          row.fetched_at ? `Date: ${new Date(row.fetched_at).toLocaleDateString()}` : '',
        ].filter(Boolean).join('. ');

        const embedding = await generateEmbedding(content);

        await db.insert(marketNewsEmbeddings).values({
          articleId: row.id,
          embedding: sql.raw(`'${JSON.stringify(embedding)}'::vector`),
          content,
        });

        count++;
      } catch (err: any) {
        console.error(`[MarketNews] Error embedding article ${row.id}:`, err.message);
      }
    }

    console.log(`[MarketNews] Generated ${count} embeddings`);
    return count;
  } catch (error: any) {
    console.error('[MarketNews] Error generating embeddings:', error.message);
    return 0;
  }
}

export async function purgeStaleMarketNews(): Promise<number> {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    console.log(`[MarketNews] Purging articles older than ${sixMonthsAgo.toLocaleDateString()}...`);

    const staleResult = await db.execute(sql`
      SELECT id FROM market_news WHERE fetched_at < ${sixMonthsAgo}
    `);

    const staleIds = (staleResult.rows as { id: number }[]).map(r => r.id);
    if (staleIds.length === 0) {
      console.log('[MarketNews] No stale articles to purge');
      return 0;
    }

    for (const id of staleIds) {
      await db.delete(marketNewsEmbeddings).where(eq(marketNewsEmbeddings.articleId, id));
    }
    for (const id of staleIds) {
      await db.delete(marketNews).where(eq(marketNews.id, id));
    }

    console.log(`[MarketNews] Purged ${staleIds.length} stale articles`);
    return staleIds.length;
  } catch (error: any) {
    console.error('[MarketNews] Error purging stale articles:', error.message);
    return 0;
  }
}

export async function syncMarketNews(queries?: string[]): Promise<{
  success: boolean;
  articlesFetched: number;
  articlesAdded: number;
  articlesUpdated: number;
  embeddingsGenerated: number;
  articlesPurged: number;
  error?: string;
}> {
  try {
    console.log('[MarketNews] Starting market news sync...');

    const purgedCount = await purgeStaleMarketNews();

    const searchQueries = queries && queries.length > 0 ? queries : DEFAULT_QUERIES;
    const articles = await fetchMarketNews(searchQueries);
    const { added, updated } = await saveMarketNews(articles);

    const embeddedCount = await generateMarketNewsEmbeddings();

    console.log(`[MarketNews] Sync complete: ${added} added, ${updated} updated, ${embeddedCount} embedded, ${purgedCount} purged`);

    return {
      success: true,
      articlesFetched: articles.length,
      articlesAdded: added,
      articlesUpdated: updated,
      embeddingsGenerated: embeddedCount,
      articlesPurged: purgedCount,
    };
  } catch (error: any) {
    console.error('[MarketNews] Sync failed:', error);
    return {
      success: false,
      articlesFetched: 0,
      articlesAdded: 0,
      articlesUpdated: 0,
      embeddingsGenerated: 0,
      articlesPurged: 0,
      error: error.message,
    };
  }
}
