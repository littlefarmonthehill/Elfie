/**
 * BrickLink Forum Scraper
 * Scrapes BrickLink discussion forum for community knowledge
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { db } from '../db';
import { blForumPosts, blForumEmbeddings } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';
import { generateEmbedding } from './embeddings';

const FORUM_LIST_URL = 'https://www.bricklink.com/messageList.asp?v=c&max=100&q=';

interface ForumPostData {
  id: string;
  threadId: string;
  title: string;
  excerpt: string;
  username: string;
  userFeedbackCount: number | null;
  postedAt: Date;
  postUrl: string;
  threadUrl: string;
  hasReplies: boolean;
}

/**
 * Scrape the BrickLink forum list page
 */
export async function scrapeForumList(): Promise<ForumPostData[]> {
  try {
    console.log('🔍 Scraping BrickLink forum list...');
    
    const response = await axios.get(FORUM_LIST_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 30000,
    });
    
    const $ = cheerio.load(response.data);
    const posts: ForumPostData[] = [];
    
    // Find all forum post rows (each row in the table)
    $('table tr').each((_, row) => {
      try {
        const $row = $(row);
        const cells = $row.find('td');
        
        if (cells.length < 3) return; // Skip header rows
        
        // Extract timestamp (first cell)
        const timestampText = $(cells[0]).text().trim();
        if (!timestampText) return;
        
        // Extract post link and title (third cell)
        const $linkCell = $(cells[2]);
        const $postLink = $linkCell.find('a').first();
        const title = $postLink.text().trim();
        const postHref = $postLink.attr('href');
        
        if (!title || !postHref) return;
        
        // Extract message ID from URL
        const postIdMatch = postHref.match(/ID=(\d+)/);
        if (!postIdMatch) return;
        const postId = postIdMatch[1];
        
        // Extract thread ID from thread icon link (second cell)
        const $threadLink = $(cells[1]).find('a');
        const threadHref = $threadLink.attr('href') || '';
        const threadIdMatch = threadHref.match(/ID=(\d+)/);
        const threadId = threadIdMatch ? threadIdMatch[1] : postId;
        
        // Extract username and feedback
        const usernameText = $linkCell.text();
        const usernameMatch = usernameText.match(/- (.+?) \((\d+)\)/);
        const username = usernameMatch ? usernameMatch[1].trim() : 'Unknown';
        const userFeedbackCount = usernameMatch ? parseInt(usernameMatch[2]) : null;
        
        // Parse timestamp
        const postedAt = parseForumTimestamp(timestampText);
        if (!postedAt) return;
        
        // Check if post has replies (thread icon present)
        const hasReplies = $threadLink.length > 0;
        
        // Build full URLs
        const postUrl = `https://www.bricklink.com${postHref}`;
        const threadUrl = threadHref ? `https://www.bricklink.com${threadHref}` : postUrl;
        
        posts.push({
          id: postId,
          threadId,
          title,
          excerpt: title, // For now, use title as excerpt (could scrape full content later)
          username,
          userFeedbackCount,
          postedAt,
          postUrl,
          threadUrl,
          hasReplies,
        });
      } catch (err) {
        console.error('⚠️ Error parsing forum row:', err);
      }
    });
    
    console.log(`✅ Scraped ${posts.length} forum posts`);
    return posts;
  } catch (error: any) {
    console.error('❌ Error scraping forum list:', error.message);
    throw error;
  }
}

/**
 * Parse BrickLink forum timestamp (e.g., "Oct 20, 2025 00:53")
 */
function parseForumTimestamp(timestampText: string): Date | null {
  try {
    // Format: "Oct 20, 2025 00:53"
    const cleanedText = timestampText.trim();
    
    // Parse using Date constructor (handles various formats)
    const date = new Date(cleanedText);
    
    if (isNaN(date.getTime())) {
      console.warn(`⚠️ Could not parse timestamp: ${timestampText}`);
      return null;
    }
    
    return date;
  } catch (err) {
    console.warn(`⚠️ Error parsing timestamp "${timestampText}":`, err);
    return null;
  }
}

/**
 * Save scraped forum posts to database
 */
export async function saveForumPosts(posts: ForumPostData[]): Promise<number> {
  let savedCount = 0;
  
  for (const post of posts) {
    try {
      // Check if post already exists
      const existing = await db.query.blForumPosts.findFirst({
        where: eq(blForumPosts.id, post.id),
      });
      
      if (existing) {
        // Update if title or content changed
        await db
          .update(blForumPosts)
          .set({
            title: post.title,
            excerpt: post.excerpt,
            lastScrapedAt: new Date(),
            updatedAt: new Date(),
            // Update lastReplyAt - for now we use postedAt (in future could scrape thread for actual last reply)
            lastReplyAt: post.postedAt,
          })
          .where(eq(blForumPosts.id, post.id));
      } else {
        // Insert new post
        await db.insert(blForumPosts).values({
          id: post.id,
          threadId: post.threadId,
          title: post.title,
          excerpt: post.excerpt,
          username: post.username,
          userFeedbackCount: post.userFeedbackCount,
          postedAt: post.postedAt,
          lastReplyAt: post.postedAt, // Initialize with post date (will update when we see it again)
          postUrl: post.postUrl,
          threadUrl: post.threadUrl,
          hasReplies: post.hasReplies,
          scrapedContent: false,
        });
        savedCount++;
      }
    } catch (err) {
      console.error(`⚠️ Error saving post ${post.id}:`, err);
    }
  }
  
  return savedCount;
}

/**
 * Generate embeddings for forum posts that don't have them yet
 */
export async function generateForumEmbeddings(): Promise<number> {
  try {
    // Find posts without embeddings
    const postsWithoutEmbeddings = await db.execute(sql`
      SELECT fp.id, fp.title, fp.excerpt, fp.username, fp.posted_at
      FROM bl_forum_posts fp
      LEFT JOIN bl_forum_embeddings fe ON fp.id = fe.post_id
      WHERE fe.post_id IS NULL
      ORDER BY fp.posted_at DESC
      LIMIT 50
    `);
    
    if (postsWithoutEmbeddings.rows.length === 0) {
      return 0;
    }
    
    console.log(`🧠 Generating embeddings for ${postsWithoutEmbeddings.rows.length} forum posts...`);
    
    let embeddedCount = 0;
    
    for (const row of postsWithoutEmbeddings.rows as any[]) {
      try {
        // Create searchable content
        const content = createForumContent(row);
        
        // Generate embedding
        const embedding = await generateEmbedding(content);
        
        // Save embedding
        await db.insert(blForumEmbeddings).values({
          postId: row.id,
          embedding: sql.raw(`'${JSON.stringify(embedding)}'::vector`),
          content,
        });
        
        embeddedCount++;
      } catch (err) {
        console.error(`⚠️ Error embedding post ${row.id}:`, err);
      }
    }
    
    console.log(`✅ Generated ${embeddedCount} forum embeddings`);
    return embeddedCount;
  } catch (error: any) {
    console.error('❌ Error generating forum embeddings:', error.message);
    return 0;
  }
}

/**
 * Create searchable content from forum post data
 */
function createForumContent(post: any): string {
  const parts = [
    `Forum Post: ${post.title}`,
    post.excerpt ? `Content: ${post.excerpt}` : '',
    `Author: ${post.username}`,
    post.posted_at ? `Date: ${new Date(post.posted_at).toLocaleDateString()}` : '',
  ];
  
  return parts.filter(Boolean).join('. ');
}

/**
 * Purge forum posts older than 6 months with no recent replies
 */
export async function purgeStaleForumPosts(): Promise<number> {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    console.log(`🗑️ Purging forum posts with no replies since ${sixMonthsAgo.toLocaleDateString()}...`);
    
    // Find stale posts
    const stalePosts = await db.query.blForumPosts.findMany({
      where: sql`${blForumPosts.lastReplyAt} < ${sixMonthsAgo}`,
      columns: { id: true },
    });
    
    if (stalePosts.length === 0) {
      console.log('✅ No stale posts to purge');
      return 0;
    }
    
    console.log(`🗑️ Found ${stalePosts.length} stale posts to purge`);
    
    // Delete embeddings first (foreign key)
    for (const post of stalePosts) {
      await db.delete(blForumEmbeddings).where(eq(blForumEmbeddings.postId, post.id));
    }
    
    // Delete posts
    const postIds = stalePosts.map(p => p.id);
    const deleteResult = await db.delete(blForumPosts).where(
      sql`${blForumPosts.id} = ANY(${postIds})`
    );
    
    console.log(`✅ Purged ${stalePosts.length} stale forum posts`);
    return stalePosts.length;
  } catch (error: any) {
    console.error('❌ Error purging stale posts:', error.message);
    return 0;
  }
}

/**
 * Full sync: scrape forum and generate embeddings
 */
export async function syncBrickLinkForum(): Promise<{
  success: boolean;
  postsScraped: number;
  postsSaved: number;
  embeddingsGenerated: number;
  postsPurged: number;
  error?: string;
}> {
  try {
    console.log('📡 Starting BrickLink forum sync...');
    
    // Step 1: Purge stale posts (older than 6 months)
    const purgedCount = await purgeStaleForumPosts();
    
    // Step 2: Scrape forum posts
    const posts = await scrapeForumList();
    
    // Step 3: Save to database
    const savedCount = await saveForumPosts(posts);
    
    // Step 4: Generate embeddings for new posts
    const embeddedCount = await generateForumEmbeddings();
    
    console.log('✅ BrickLink forum sync complete');
    
    return {
      success: true,
      postsScraped: posts.length,
      postsSaved: savedCount,
      embeddingsGenerated: embeddedCount,
      postsPurged: purgedCount,
    };
  } catch (error: any) {
    console.error('❌ Forum sync failed:', error);
    return {
      success: false,
      postsScraped: 0,
      postsSaved: 0,
      embeddingsGenerated: 0,
      postsPurged: 0,
      error: error.message,
    };
  }
}
