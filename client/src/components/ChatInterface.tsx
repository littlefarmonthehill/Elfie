import { useState, useEffect, useRef } from "react";
import { Send, RefreshCcw, Minimize2, Maximize2, ExternalLink, Sparkles, Brain, ChevronDown, ChevronRight, Globe, Clock, Newspaper, MessageSquare, Headphones, Lightbulb, Plus, History, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InventoryGroup } from "@/components/InventoryGroup";
import { OrderGroup } from "@/components/OrderGroup";
import { ForumDiscussionsGroup } from "@/components/ForumDiscussionsGroup";
import { MarketNewsGroup } from "@/components/MarketNewsGroup";
import { useToast } from "@/hooks/use-toast";
import elfieRobot from "@assets/PlanetBrick_good_robot_1760672362080.png";

function InlineNewsCard({ title, snippet, url, source, type, dateStr, username, replyCount, onSummarize }: {
  title: string;
  snippet?: string;
  url: string;
  source?: string;
  type: 'news' | 'forum';
  dateStr?: string;
  username?: string;
  replyCount?: number;
  onSummarize?: (title: string, snippet: string, url: string, type: string) => Promise<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [aiOverview, setAiOverview] = useState<string | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  const getDomain = (u: string) => {
    try { return new URL(u).hostname.replace('www.', ''); } catch { return ''; }
  };

  const handleExpand = async () => {
    const willExpand = !expanded;
    setExpanded(willExpand);
    if (willExpand && !aiOverview && snippet && onSummarize) {
      setLoadingOverview(true);
      try {
        const overview = await onSummarize(title, snippet, url, type);
        setAiOverview(overview);
      } catch {
        setAiOverview(null);
      } finally {
        setLoadingOverview(false);
      }
    }
  };

  const displaySource = type === 'forum' ? 'BrickLink Forum' : (source || getDomain(url) || 'Web');

  return (
    <div className="rounded-md bg-purple-900/10 border border-purple-500/10 mb-1 overflow-hidden" data-testid={`inline-card-${type}`}>
      <button
        onClick={handleExpand}
        className="w-full flex items-start gap-2 py-2 px-3 text-left"
        data-testid={`button-expand-${type}-card`}
      >
        <div className="flex-shrink-0 mt-0.5">
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-purple-400" />
            : <ChevronRight className="h-3.5 w-3.5 text-purple-400" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-gray-200 line-clamp-2">{title}</span>
          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500">
            <span className="flex items-center gap-1">
              {type === 'forum' ? <MessageSquare className="h-2.5 w-2.5" /> : <Globe className="h-2.5 w-2.5" />}
              {displaySource}
            </span>
            {type === 'forum' && username && (
              <span>by {username}</span>
            )}
            {replyCount !== undefined && replyCount > 0 && (
              <span>{replyCount} {replyCount === 1 ? 'reply' : 'replies'}</span>
            )}
          </div>
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 pl-8 space-y-2">
          {loadingOverview && (
            <div className="flex items-center gap-2 text-xs text-purple-400">
              <Brain className="h-3 w-3 animate-pulse" />
              <span>{type === 'forum' ? 'Analyzing discussion...' : 'Generating overview...'}</span>
            </div>
          )}
          {aiOverview && (
            <div className="text-xs text-gray-300 leading-relaxed bg-purple-900/20 rounded px-2.5 py-2 border border-purple-500/10">
              <div className="flex items-center gap-1.5 text-purple-400 mb-1">
                <Brain className="h-3 w-3" />
                <span className="font-medium text-[11px] uppercase tracking-wide">AI Overview</span>
              </div>
              {aiOverview}
            </div>
          )}
          {!aiOverview && !loadingOverview && snippet && (
            <p className="text-xs text-gray-400 leading-relaxed">{snippet}</p>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); window.open(url, '_blank', 'noopener,noreferrer'); }}
            className="inline-flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300"
            data-testid={`button-open-${type}-link`}
          >
            <ExternalLink className="h-3 w-3" />
            {type === 'news' ? 'Read Article' : 'View Thread'}
          </button>
        </div>
      )}
    </div>
  );
}

interface DedupedForum {
  id: string;
  threadId: string;
  title: string;
  excerpt: string | null;
  username: string;
  threadUrl: string;
  replyCount: number;
  relevance: string;
}

function deduplicateForums(forums: Array<{
  id: string; threadId: string; title: string; excerpt: string | null;
  username: string; userFeedbackRating: number; postedAt: string;
  postUrl: string; threadUrl: string; hasReplies: boolean; relevance: string;
}>): DedupedForum[] {
  if (!forums || forums.length === 0) return [];
  const byThread = new Map<string, typeof forums>();
  forums.forEach(f => {
    const key = f.threadId;
    if (!byThread.has(key)) byThread.set(key, []);
    byThread.get(key)!.push(f);
  });
  return Array.from(byThread.values()).map(group => {
    const original = group.find(p => !p.title.startsWith('Re:') && !p.title.startsWith('RE:')) || group[0];
    return {
      id: original.id,
      threadId: original.threadId,
      title: original.title.replace(/^Re:\s*/i, '').trim(),
      excerpt: original.excerpt,
      username: original.username,
      threadUrl: original.threadUrl,
      replyCount: group.length - 1,
      relevance: original.relevance,
    };
  });
}

const THEME_KEYWORD_MAP: Record<string, string[]> = {
  retirement: ['retire', 'retiring', 'retired', 'end-of-life', 'eol', 'discontinued', 'last chance', 'leaving shelves', 'phased out'],
  pricing: ['price', 'pricing', 'value', 'cost', 'expensive', 'cheap', 'aftermarket', 'markup', 'margin', 'discount', 'deal', 'msrp', 'sale'],
  release: ['release', 'new set', 'new lego', 'launch', 'announced', 'reveal', 'leaked', 'upcoming', 'rumor', 'rumour', '2025', '2026'],
  supply: ['supply', 'chain', 'shortage', 'restock', 'availability', 'production', 'factory', 'warehouse', 'shipping', 'stock'],
  investing: ['invest', 'collectible', 'collector', 'rare', 'sealed', 'appreciation', 'portfolio', 'roi', 'long-term', 'vintage', 'modular'],
  market: ['market', 'trend', 'economy', 'demand', 'reseller', 'resale', 'bricklink', 'ebay', 'marketplace', 'seller', 'buyer', 'trade'],
};

function themeMatchScore(theme: string, text: string): number {
  const tl = theme.toLowerCase();
  const tgt = text.toLowerCase();
  let score = 0;
  const headerWords = tl.split(/[\s&,]+/).filter(w => w.length > 3);
  const headerWordMatches = headerWords.filter(w => tgt.includes(w)).length;
  score += headerWordMatches * 3;
  let categoryMatches = 0;
  for (const [category, keywords] of Object.entries(THEME_KEYWORD_MAP)) {
    if (tl.includes(category) || keywords.some(k => tl.includes(k))) {
      const hits = keywords.filter(k => tgt.includes(k)).length;
      score += hits * 2;
      if (hits > 0) categoryMatches++;
    }
  }
  if (headerWordMatches === 0 && categoryMatches === 0) return 0;
  if (headerWordMatches === 0 && score < 4) return 0;
  return score;
}

interface ChatMessage {
  role: 'user' | 'assistant' | 'support' | 'system';
  content: string;
  messageId?: string;
  streaming?: boolean;
  imageUrl?: string;
  items?: Array<{
    id: number;
    itemNo: string;
    itemName: string | null;
    colorId: number | null;
    colorName: string | null;
    colorRgb: string | null;
    quantity: number;
    unitPrice: string | null;
    newOrUsed: string;
  }>;
  orders?: Array<{
    id: string;
    orderNumber: string;
    marketplace: string | null;
    orderDate: string;
    orderTotal: string;
    customerUsername: string;
    orderStatus: string;
  }>;
  forumDiscussions?: Array<{
    id: string;
    threadId: string;
    title: string;
    excerpt: string | null;
    username: string;
    userFeedbackRating: number;
    postedAt: string;
    postUrl: string;
    threadUrl: string;
    hasReplies: boolean;
    relevance: string;
  }>;
  marketNewsArticles?: Array<{
    id: number;
    title: string;
    snippet: string;
    url: string;
    source: string;
    topic: string;
    fetchedAt: string;
    relevance: string;
  }>;
  bricklinkSearchSuggestion?: {
    itemNo: string;
    itemType: string;
  } | null;
}

interface MessageContentProps {
  content: string;
  imageUrl?: string;
  items?: Array<{
    id: number;
    itemNo: string;
    itemName: string | null;
    colorId: number | null;
    colorName: string | null;
    colorRgb: string | null;
    quantity: number;
    unitPrice: string | null;
    newOrUsed: string;
  }>;
  orders?: Array<{
    id: string;
    orderNumber: string;
    marketplace: string | null;
    orderDate: string;
    orderTotal: string;
    customerUsername: string;
    orderStatus: string;
  }>;
  forumDiscussions?: Array<{
    id: string;
    threadId: string;
    title: string;
    excerpt: string | null;
    username: string;
    userFeedbackRating: number;
    postedAt: string;
    postUrl: string;
    threadUrl: string;
    hasReplies: boolean;
    relevance: string;
  }>;
  marketNewsArticles?: Array<{
    id: number;
    title: string;
    snippet: string;
    url: string;
    source: string;
    topic: string;
    fetchedAt: string;
    relevance: string;
  }>;
  bricklinkSearchSuggestion?: {
    itemNo: string;
    itemType: string;
  } | null;
  onItemClick?: (type: 'inventory' | 'order', id: string) => void;
  onBrickLinkSearch?: (itemNo: string, itemType: string) => void;
  onPromptClick?: (prompt: string) => void;
  onSummarize?: (title: string, snippet: string, url: string, type: string) => Promise<string>;
}

function MessageContent({ content, imageUrl, items, orders, forumDiscussions, marketNewsArticles, bricklinkSearchSuggestion, onItemClick, onBrickLinkSearch, onPromptClick, onSummarize }: MessageContentProps) {

  const dedupedForums = deduplicateForums(forumDiscussions || []);
  const allNewsCards = marketNewsArticles || [];
  const matchedNewsIds = new Set<number>();
  const matchedForumIds = new Set<string>();
  let currentThemeText = '';
  let themedCardsInjected = false;

  const themeHeaders: string[] = [];
  const isInventoryImpactTheme = (t: string) => /impact.*inventor|inventor.*impact/i.test(t);

  const flushThemeCards = (elements: JSX.Element[], keyRef: { value: number }) => {
    if (!currentThemeText) return;
    if (isInventoryImpactTheme(currentThemeText)) return;
    const isForumTheme = /community|forum|discussion|chatter|buzz|thread/i.test(currentThemeText);

    if (!isForumTheme) {
      themeHeaders.push(currentThemeText);
      const available = allNewsCards.filter(a => !matchedNewsIds.has(a.id));
      const scored = available.map(a => ({
        article: a,
        score: themeMatchScore(currentThemeText, `${a.title} ${a.snippet || ''} ${a.topic || ''}`),
      })).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

      const maxPerTheme = Math.max(3, Math.ceil(allNewsCards.length / Math.max(themeHeaders.length + 1, 2)));
      const topScored = scored.slice(0, maxPerTheme);

      topScored.forEach(({ article }) => {
        matchedNewsIds.add(article.id);
        themedCardsInjected = true;
        elements.push(
          <InlineNewsCard key={`tnews-${keyRef.value++}`} type="news" title={article.title} snippet={article.snippet} url={article.url} source={article.source} onSummarize={onSummarize} />
        );
      });
    }

    if (isForumTheme) {
      dedupedForums.filter(f => !matchedForumIds.has(f.id)).forEach(f => {
        matchedForumIds.add(f.id);
        themedCardsInjected = true;
        elements.push(
          <InlineNewsCard key={`tforum-${keyRef.value++}`} type="forum" title={f.title} snippet={f.excerpt || 'Click to view discussion thread and AI analysis'} url={f.threadUrl} username={f.username} replyCount={f.replyCount} onSummarize={onSummarize} />
        );
      });
    }
  };

  // Parse markdown bullet points and create clickable elements
  const structuredUrlList: string[] = [];
  const structuredUrlSet = new Set<string>();
  const structuredTitles: string[] = [];
  allNewsCards.forEach(a => {
    if (a.url) {
      const norm = a.url.replace(/\/$/, '').toLowerCase();
      if (!structuredUrlSet.has(norm)) { structuredUrlSet.add(norm); structuredUrlList.push(norm); }
    }
    if (a.title) structuredTitles.push(a.title.toLowerCase());
  });
  dedupedForums.forEach(f => {
    if (f.threadUrl) {
      const norm = f.threadUrl.replace(/\/$/, '').toLowerCase();
      if (!structuredUrlSet.has(norm)) { structuredUrlSet.add(norm); structuredUrlList.push(norm); }
    }
    if (f.title) structuredTitles.push(f.title.toLowerCase());
  });

  const lineHasStructuredDuplicate = (line: string): boolean => {
    if (structuredUrlList.length === 0 && structuredTitles.length === 0) return false;
    const lower = line.toLowerCase();
    const urlMatches = line.match(/https?:\/\/[^\s)>\]]+/g);
    if (urlMatches) {
      for (let ui = 0; ui < urlMatches.length; ui++) {
        const norm = urlMatches[ui].replace(/\)*$/, '').replace(/\/$/, '').toLowerCase();
        if (structuredUrlSet.has(norm)) return true;
        for (let si = 0; si < structuredUrlList.length; si++) {
          const su = structuredUrlList[si];
          if (norm.includes('messagethread') && su.includes('messagethread')) {
            const normId = norm.match(/id=(\d+)/i)?.[1];
            const suId = su.match(/id=(\d+)/i)?.[1];
            if (normId && suId && normId === suId) return true;
          }
          if (norm.length > 30 && su.length > 30 && (norm.includes(su) || su.includes(norm))) return true;
        }
      }
    }
    for (let ti = 0; ti < structuredTitles.length; ti++) {
      const title = structuredTitles[ti];
      if (title.length > 15 && lower.includes(title)) return true;
    }
    return false;
  };

  const parseContent = (text: string) => {
    const lines = text.split('\n');
    const elements: JSX.Element[] = [];
    let currentParagraph: string[] = [];
    let key = 0;
    const keyRef = { value: 0 };

    const flushParagraph = () => {
      if (currentParagraph.length > 0) {
        const paraText = currentParagraph.join(' ');
        elements.push(
          <p key={`para-${key++}`} className="mb-2 leading-relaxed break-words" style={{ overflowWrap: 'anywhere' }}>
            {parseInlineContent(paraText)}
          </p>
        );
        currentParagraph = [];
      }
    };

    const parseBoldAndText = (text: string, keyPrefix: string = 'b') => {
      const parts: (string | JSX.Element)[] = [];
      const boldRegex = /\*\*([^*]+)\*\*/g;
      let lastIdx = 0;
      let bMatch;
      while ((bMatch = boldRegex.exec(text)) !== null) {
        if (bMatch.index > lastIdx) {
          parts.push(text.substring(lastIdx, bMatch.index));
        }
        parts.push(
          <strong key={`${keyPrefix}-${bMatch.index}`} className="text-gray-100 font-semibold">{bMatch[1]}</strong>
        );
        lastIdx = bMatch.index + bMatch[0].length;
      }
      if (lastIdx < text.length) {
        parts.push(text.substring(lastIdx));
      }
      return parts.length > 0 ? parts : [text];
    };

    const parseInlineContent = (text: string) => {
      const parts: (string | JSX.Element)[] = [];
      let lastIndex = 0;

      const promptRegex = /\*\*PROMPT:\*\*\s*["""\u201C\u201D]([^"""\u201C\u201D\n]+)["""\u201C\u201D]/g;
      const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
      const bareUrlRegex = /https?:\/\/[^\s)]+/g;
      
      const promptMatches: Array<{ start: number; end: number; prompt: string; type: 'prompt' }> = [];
      let promptMatch;
      while ((promptMatch = promptRegex.exec(text)) !== null) {
        promptMatches.push({
          start: promptMatch.index,
          end: promptMatch.index + promptMatch[0].length,
          prompt: promptMatch[1].trim(),
          type: 'prompt'
        });
      }
      
      const markdownMatches: Array<{ start: number; end: number; text: string; url: string; type: 'link' }> = [];
      let mdMatch;
      while ((mdMatch = markdownLinkRegex.exec(text)) !== null) {
        const isCoveredByPrompt = promptMatches.some(
          p => mdMatch!.index >= p.start && mdMatch!.index < p.end
        );
        if (!isCoveredByPrompt) {
          markdownMatches.push({
            start: mdMatch.index,
            end: mdMatch.index + mdMatch[0].length,
            text: mdMatch[1],
            url: mdMatch[2],
            type: 'link'
          });
        }
      }
      
      const bareUrlMatches: Array<{ start: number; end: number; text: string | null; url: string; type: 'link' }> = [];
      let bareMatch: RegExpExecArray | null;
      while ((bareMatch = bareUrlRegex.exec(text)) !== null) {
        const isCoveredByMarkdown = markdownMatches.some(
          md => bareMatch!.index >= md.start && bareMatch!.index < md.end
        );
        const isCoveredByPrompt = promptMatches.some(
          p => bareMatch!.index >= p.start && bareMatch!.index < p.end
        );
        if (!isCoveredByMarkdown && !isCoveredByPrompt) {
          bareUrlMatches.push({
            start: bareMatch.index,
            end: bareMatch.index + bareMatch[0].length,
            text: null,
            url: bareMatch[0],
            type: 'link'
          });
        }
      }
      
      const allMatches = [...promptMatches, ...markdownMatches, ...bareUrlMatches];
      allMatches.sort((a, b) => a.start - b.start);
      
      allMatches.forEach((match, idx) => {
        if (match.start > lastIndex) {
          const beforeText = text.substring(lastIndex, match.start);
          const parsed = parsePartNumbers(beforeText);
          parsed.forEach(p => {
            if (typeof p === 'string') {
              parts.push(...parseBoldAndText(p, `pre-${idx}`));
            } else {
              parts.push(p);
            }
          });
        }
        
        if (match.type === 'prompt') {
          const promptText = (match as any).prompt;
          parts.push(
            <button
              key={`prompt-${idx}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onPromptClick?.(promptText);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 my-1 mr-2 rounded-full bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-500/40 text-cyan-300 hover:from-cyan-500/30 hover:to-purple-500/30 hover:border-cyan-400 transition-all text-sm font-medium"
              data-testid={`prompt-${promptText.toLowerCase().replace(/\s+/g, '-').substring(0, 30)}`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {promptText}
            </button>
          );
        } else {
          const displayText = (match as any).text || getShortUrlText((match as any).url);
          const handleLinkClick = (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            window.open((match as any).url, '_blank', 'noopener,noreferrer');
          };
          
          parts.push(
            <button
              key={`url-${idx}`}
              onClick={handleLinkClick}
              className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300 underline break-all max-w-full"
              data-testid={`link-${displayText.toLowerCase().replace(/\s+/g, '-')}`}
            >
              {displayText}
              <ExternalLink className="h-3 w-3" />
            </button>
          );
        }
        
        lastIndex = match.end;
      });

      if (lastIndex < text.length) {
        const remaining = text.substring(lastIndex);
        const parsed = parsePartNumbers(remaining);
        parsed.forEach((p, pi) => {
          if (typeof p === 'string') {
            parts.push(...parseBoldAndText(p, `rem-${pi}`));
          } else {
            parts.push(p);
          }
        });
      }

      return parts.length > 0 ? parts : text;
    };

    // Helper function to generate short, readable text for URLs
    const getShortUrlText = (url: string): string => {
      try {
        const urlObj = new URL(url);
        const domain = urlObj.hostname.replace('www.', '');
        
        // Special cases for known domains
        if (domain.includes('bricklink.com')) return 'View on BrickLink';
        if (domain.includes('brickset.com')) return 'View on Brickset';
        if (domain.includes('rebrickable.com')) return 'View on Rebrickable';
        if (domain.includes('youtube.com') || domain.includes('youtu.be')) return 'Watch Video';
        if (domain.includes('reddit.com')) return 'View Reddit Post';
        if (domain.includes('instagram.com')) return 'View on Instagram';
        if (domain.includes('twitter.com') || domain.includes('x.com')) return 'View on Twitter';
        
        // For articles/news sites, try to use pathname
        const pathParts = urlObj.pathname.split('/').filter(p => p && p.length > 2);
        if (pathParts.length > 0) {
          // Capitalize and clean up the last meaningful path segment
          const lastPart = pathParts[pathParts.length - 1]
            .replace(/[-_]/g, ' ')
            .replace(/\.[^.]+$/, ''); // Remove file extension
          
          if (lastPart.length > 5 && lastPart.length < 30) {
            return lastPart.charAt(0).toUpperCase() + lastPart.slice(1).substring(0, 25);
          }
        }
        
        // Default: capitalize domain name
        const domainName = domain.split('.')[0];
        return domainName.charAt(0).toUpperCase() + domainName.slice(1);
      } catch (e) {
        return 'View Link';
      }
    };

    const parsePartNumbers = (text: string) => {
      if (!items || items.length === 0) return [text];

      const parts: (string | JSX.Element)[] = [];
      let lastIndex = 0;

      // Escape special regex characters
      const escapeRegex = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      
      // First, try to match color/condition level patterns: "Part [ITEMNO] in [COLOR]: ... ([CONDITION])"
      // Pattern: Part 3021 in Red: 50 units @ $0.25 (New)
      const colorConditionRegex = /Part\s+(\S+)\s+in\s+([^:]+):\s+[^(]+\(([^)]+)\)/g;
      let match;

      while ((match = colorConditionRegex.exec(text)) !== null) {
        const [fullMatch, itemNo, colorName, condition] = match;
        
        // Add text before the match
        if (match.index > lastIndex) {
          parts.push(text.substring(lastIndex, match.index));
        }

        // Find exact matching item (itemNo + color + condition)
        const matchingItem = items.find(item => 
          item.itemNo === itemNo && 
          item.colorName?.toLowerCase() === colorName.trim().toLowerCase() &&
          item.newOrUsed?.toLowerCase() === condition.trim().toLowerCase()
        );
        
        if (matchingItem) {
          parts.push(
            <button
              key={`item-${match.index}`}
              onClick={() => onItemClick?.('inventory', matchingItem.id.toString())}
              className="inline text-purple-400 hover:text-purple-300 font-semibold underline decoration-dotted"
              title={`View details for ${matchingItem.itemNo} in ${matchingItem.colorName} (${matchingItem.newOrUsed})`}
            >
              {fullMatch}
            </button>
          );
        } else {
          parts.push(fullMatch);
        }

        lastIndex = match.index + fullMatch.length;
      }

      // Add remaining text (or all text if no color/condition patterns found)
      if (lastIndex < text.length) {
        const remainingText = text.substring(lastIndex);
        
        // Fallback: Try matching just part numbers in the remaining text
        const partNumbers = items.map(item => escapeRegex(item.itemNo));
        const partRegex = new RegExp(`\\b(${partNumbers.join('|')})\\b`, 'g');
        let partMatch;
        let partLastIndex = 0;

        while ((partMatch = partRegex.exec(remainingText)) !== null) {
          if (partMatch.index > partLastIndex) {
            parts.push(remainingText.substring(partLastIndex, partMatch.index));
          }

          const matchingItem = items.find(item => item.itemNo === partMatch![1]);
          if (matchingItem) {
            parts.push(
              <button
                key={`part-${lastIndex + partMatch.index}`}
                onClick={() => onItemClick?.('inventory', matchingItem.id.toString())}
                className="inline text-purple-400 hover:text-purple-300 font-semibold underline decoration-dotted"
                title={`View details for ${matchingItem.itemNo}`}
              >
                {partMatch[1]}
              </button>
            );
          } else {
            parts.push(partMatch[1]);
          }

          partLastIndex = partMatch.index + partMatch[0].length;
        }

        if (partLastIndex < remainingText.length) {
          parts.push(remainingText.substring(partLastIndex));
        }
      }

      return parts.length > 0 ? parts : [text];
    };

    let statBuffer: Array<{ label: string; value: string }> = [];
    const deferredPrompts: string[] = [];
    
    const flushStats = () => {
      if (statBuffer.length > 0) {
        const cols = statBuffer.length <= 2 ? statBuffer.length : statBuffer.length <= 4 ? 2 : 3;
        elements.push(
          <div key={`stats-${key++}`} className={`grid grid-cols-${cols} gap-2 mb-2`}
               style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
            {statBuffer.map((stat, si) => (
              <div key={`stat-${si}`} className="rounded-lg bg-purple-900/20 border border-purple-500/15 p-2.5 text-center">
                <div className="text-lg font-bold text-white font-mono">{stat.value}</div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400 mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>
        );
        statBuffer = [];
      }
    };

    lines.forEach((line, index) => {
      const trimmed = line.trim();
      
      const statMatch = trimmed.match(/^>\s*\*{0,2}([^*|:]+?)\*{0,2}\s*[:|]\s*(.+)$/);
      if (statMatch) {
        flushParagraph();
        statBuffer.push({ label: statMatch[1].trim(), value: statMatch[2].trim() });
        return;
      }
      
      if (statBuffer.length > 0) {
        flushStats();
      }
      
      if (/^#{1,3}\s/.test(trimmed)) {
        flushParagraph();
        flushThemeCards(elements, keyRef);
        const headerText = trimmed.replace(/^#{1,3}\s+/, '');
        currentThemeText = headerText;
        if (!isInventoryImpactTheme(headerText)) {
          elements.push(
            <div key={`header-${key++}`} className="text-xs font-semibold text-purple-300 uppercase tracking-wider mt-3 mb-1.5 border-b border-purple-500/20 pb-1">
              {parseInlineContent(headerText)}
            </div>
          );
        }
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
        if (isInventoryImpactTheme(currentThemeText)) return;
        if (lineHasStructuredDuplicate(trimmed)) return;
        flushParagraph();
        const bulletText = trimmed.substring(2);
        const kvMatch = bulletText.match(/^\*{0,2}([^*]+?)\*{0,2}\s*[—–:]\s*(.+)$/);
        if (kvMatch) {
          elements.push(
            <div key={`bullet-${key++}`} className="py-1.5 px-3 rounded-md bg-purple-900/10 border border-purple-500/10 mb-1">
              <span className="text-gray-200 font-medium text-sm">{parseInlineContent(kvMatch[1].trim())}</span>
              <span className="text-gray-400 text-sm"> — </span>
              <span className="text-gray-400 text-sm break-words">{parseInlineContent(kvMatch[2].trim())}</span>
            </div>
          );
        } else {
          elements.push(
            <div key={`bullet-${key++}`} className="flex gap-2.5 py-1.5 px-3 rounded-md bg-purple-900/10 border border-purple-500/10 mb-1">
              <span className="text-purple-400 shrink-0 mt-0.5">•</span>
              <span className="flex-1 text-sm break-words overflow-hidden">{parseInlineContent(bulletText)}</span>
            </div>
          );
        }
      } else if (/^\d+\.\s/.test(trimmed)) {
        if (isInventoryImpactTheme(currentThemeText)) return;
        if (lineHasStructuredDuplicate(trimmed)) return;
        flushParagraph();
        const numMatch = trimmed.match(/^(\d+)\.\s/);
        const num = numMatch ? numMatch[1] : '';
        const bulletText = trimmed.replace(/^\d+\.\s/, '');
        const kvMatch = bulletText.match(/^\*{0,2}([^*]+?)\*{0,2}\s*[—–:]\s*(.+)$/);
        if (kvMatch) {
          elements.push(
            <div key={`numbered-${key++}`} className="py-1.5 px-3 rounded-md bg-purple-900/10 border border-purple-500/10 mb-1">
              <span className="text-purple-400 font-mono text-xs">{num}.</span>
              <span className="text-gray-200 font-medium text-sm ml-2">{parseInlineContent(kvMatch[1].trim())}</span>
              <span className="text-gray-400 text-sm"> — </span>
              <span className="text-gray-400 text-sm break-words">{parseInlineContent(kvMatch[2].trim())}</span>
            </div>
          );
        } else {
          elements.push(
            <div key={`numbered-${key++}`} className="flex gap-2.5 py-1.5 px-3 rounded-md bg-purple-900/10 border border-purple-500/10 mb-1">
              <span className="text-purple-400 shrink-0 min-w-[1.4em] text-right font-mono text-xs mt-0.5">{num}.</span>
              <span className="flex-1 text-sm break-words overflow-hidden">{parseInlineContent(bulletText)}</span>
            </div>
          );
        }
      } else if (/\*\*PROMPT:\*\*/.test(trimmed)) {
        flushParagraph();
        const promptRegex = /\*\*PROMPT:\*\*\s*["""\u201C\u201D]([^"""\u201C\u201D\n]+)["""\u201C\u201D]/g;
        let pm;
        while ((pm = promptRegex.exec(trimmed)) !== null) {
          deferredPrompts.push(pm[1].trim());
        }
      } else if (trimmed === '') {
        flushParagraph();
      } else {
        if (!isInventoryImpactTheme(currentThemeText) && !lineHasStructuredDuplicate(trimmed)) {
          currentParagraph.push(line);
        }
      }
    });

    flushStats();
    flushParagraph();
    flushThemeCards(elements, keyRef);

    const unmatchedNews = allNewsCards.filter(a => !matchedNewsIds.has(a.id));
    if (unmatchedNews.length > 0) {
      if (!themedCardsInjected) {
        elements.push(
          <div key={`header-more-${key++}`} className="text-xs font-semibold text-purple-300 uppercase tracking-wider mt-3 mb-1.5 border-b border-purple-500/20 pb-1">
            More Headlines
          </div>
        );
      }
      unmatchedNews.forEach(a => {
        elements.push(
          <InlineNewsCard key={`unews-${keyRef.value++}`} type="news" title={a.title} snippet={a.snippet} url={a.url} source={a.source} onSummarize={onSummarize} />
        );
      });
    }

    const unmatchedForums = dedupedForums.filter(f => !matchedForumIds.has(f.id));
    if (unmatchedForums.length > 0 && !themedCardsInjected) {
      unmatchedForums.forEach(f => {
        elements.push(
          <InlineNewsCard key={`uforum-${keyRef.value++}`} type="forum" title={f.title} snippet={f.excerpt || 'Click to view discussion thread and AI analysis'} url={f.threadUrl} username={f.username} replyCount={f.replyCount} onSummarize={onSummarize} />
        );
      });
    }

    if (deferredPrompts.length > 0) {
      elements.push(
        <div key={`deferred-prompts-${key++}`} className="flex flex-wrap gap-2 mt-3">
          {deferredPrompts.map((promptText, pi) => (
            <button
              key={`dp-${pi}`}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPromptClick?.(promptText); }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-500/40 text-cyan-300 hover:from-cyan-500/30 hover:to-purple-500/30 hover:border-cyan-400 transition-all text-sm font-medium"
              data-testid={`prompt-${promptText.toLowerCase().replace(/\s+/g, '-').substring(0, 30)}`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              {promptText}
            </button>
          ))}
        </div>
      );
    }

    return elements;
  };

  return (
    <div className="w-full space-y-2">
      {imageUrl && (
        <div className="flex justify-center p-3 rounded-lg bg-gray-900/50 border border-purple-500/20">
          <img 
            src={imageUrl} 
            alt="LEGO part" 
            className="max-w-[200px] max-h-[200px] object-contain"
            data-testid="img-chat-part"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
      )}
      
      {/* Always show the AI's text response when present */}
      {content && content.trim().length > 0 && (
        <div className="space-y-1 text-gray-300 text-sm md:text-base lg:text-lg">
          {parseContent(content)}
        </div>
      )}
      
      {/* Show inventory items if available (e.g., from image recognition) */}
      {items && items.length > 0 && (
        <InventoryGroup
          itemNo={items[0].itemNo}
          items={items}
          onItemClick={(id) => onItemClick?.('inventory', String(id))}
        />
      )}
      
      {/* Show orders if available */}
      {orders && orders.length > 0 && (
        <OrderGroup
          orders={orders}
          onOrderClick={(id) => onItemClick?.('order', id)}
        />
      )}
      
      {!themedCardsInjected && forumDiscussions && forumDiscussions.length > 0 && (
        <ForumDiscussionsGroup
          discussions={forumDiscussions}
        />
      )}

      {!themedCardsInjected && marketNewsArticles && marketNewsArticles.length > 0 && (
        <MarketNewsGroup
          articles={marketNewsArticles}
        />
      )}
      
      {/* Show BrickLink search button if suggestion is present */}
      {bricklinkSearchSuggestion && onBrickLinkSearch && (
        <div className="mt-3">
          <Button
            onClick={() => onBrickLinkSearch(bricklinkSearchSuggestion.itemNo, bricklinkSearchSuggestion.itemType)}
            variant="outline"
            size="sm"
            className="bg-purple-500/10 border-purple-500/30 text-purple-300 hover:bg-purple-500/20 hover:text-purple-200"
            data-testid="button-bricklink-search"
          >
            <ExternalLink className="h-3 w-3 mr-2" />
            Search BrickLink Catalog for {bricklinkSearchSuggestion.itemNo}
          </Button>
        </div>
      )}
    </div>
  );
}

function StreamingMessage({ message, onItemClick, onBrickLinkSearch, onPromptClick, onSummarize, onStreamingDone }: {
  message: ChatMessage;
  onItemClick?: (type: 'inventory' | 'order', id: string) => void;
  onBrickLinkSearch?: (itemNo: string, itemType: string) => void;
  onPromptClick?: (prompt: string) => void;
  onSummarize?: (title: string, snippet: string, url: string, type: string) => Promise<string>;
  onStreamingDone?: () => void;
}) {
  const content = message.content;
  const totalChars = content.length;
  const [revealedChars, setRevealedChars] = useState(message.streaming ? 0 : totalChars);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!message.streaming) {
      setRevealedChars(totalChars);
      return;
    }
    setRevealedChars(0);
    doneRef.current = false;
    let charIdx = 0;
    let cancelled = false;

    const CHARS_PER_TICK = 3;
    const TICK_MS = 25;
    const NEWLINE_PAUSE = 80;
    const HEADER_PAUSE = 200;

    const tick = () => {
      if (cancelled) return;
      const nextIdx = Math.min(charIdx + CHARS_PER_TICK, totalChars);
      const chunk = content.substring(charIdx, nextIdx);
      charIdx = nextIdx;
      setRevealedChars(charIdx);

      if (charIdx >= totalChars) {
        if (!doneRef.current) {
          doneRef.current = true;
          onStreamingDone?.();
        }
        return;
      }

      let delay = TICK_MS;
      if (chunk.includes('\n')) {
        const nextLine = content.substring(charIdx, content.indexOf('\n', charIdx)).trim();
        if (/^#{1,3}\s/.test(nextLine)) {
          delay = HEADER_PAUSE;
        } else {
          delay = NEWLINE_PAUSE;
        }
      }
      setTimeout(tick, delay);
    };

    setTimeout(tick, 150);
    return () => { cancelled = true; };
  }, [content, message.streaming]);

  const revealedContent = content.substring(0, revealedChars);
  const streamingDone = revealedChars >= totalChars;

  const allLines = content.split('\n');
  const revealedLines = revealedContent.split('\n');
  const revealedLineCount = revealedLines.length;

  let completedSections = 0;
  let inSection = false;
  for (let i = 0; i < allLines.length; i++) {
    const trimmed = allLines[i].trim();
    if (/^#{1,3}\s/.test(trimmed)) {
      if (inSection && i <= revealedLineCount) {
        completedSections++;
      }
      inSection = true;
    }
  }
  if (inSection && revealedLineCount >= allLines.length) {
    completedSections++;
  }

  const allNews = message.marketNewsArticles || [];
  const allForums = message.forumDiscussions || [];
  const totalSections = allLines.filter(l => /^#{1,3}\s/.test(l.trim())).length;
  const sectionProgress = totalSections > 0 ? completedSections / totalSections : 0;
  const newsToShow = streamingDone ? allNews : allNews.slice(0, Math.floor(allNews.length * sectionProgress));
  const forumsToShow = streamingDone ? allForums : allForums.slice(0, Math.floor(allForums.length * sectionProgress));

  return (
    <MessageContent
      content={revealedContent}
      imageUrl={message.imageUrl}
      items={message.items}
      orders={message.orders}
      forumDiscussions={forumsToShow}
      marketNewsArticles={newsToShow}
      bricklinkSearchSuggestion={streamingDone ? message.bricklinkSearchSuggestion : null}
      onItemClick={onItemClick}
      onBrickLinkSearch={onBrickLinkSearch}
      onPromptClick={onPromptClick}
      onSummarize={onSummarize}
    />
  );
}

interface MarketIntel {
  forum: {
    count: number;
    posts: Array<{ title: string; excerpt: string; username: string; postedAt: string; threadUrl: string }>;
  };
  news: {
    count: number;
    articles: Array<{ title: string; snippet: string; url: string; source: string; query: string; fetchedAt: string }>;
  };
}

interface ChatInterfaceProps {
  dashboardContext: string;
  themeColor: 'red' | 'blue' | 'yellow' | 'green' | 'orange' | 'purple';
  prompts: string[];
  onPromptAction?: (prompt: string) => void;
  onItemClick?: (type: 'inventory' | 'order' | 'sales' | 'marketing', id: string) => void;
  isMinimized?: boolean;
  onToggleMinimize?: () => void;
  marketIntel?: MarketIntel | null;
  onSupportNotification?: (hasNew: boolean) => void;
}

export default function ChatInterface({ dashboardContext, themeColor, prompts, onPromptAction, onItemClick, isMinimized = true, onToggleMinimize, marketIntel, onSupportNotification }: ChatInterfaceProps) {
  // Chat has its own distinct purple/violet color scheme
  const colors = {
    gradient: 'from-purple-500/20 via-violet-500/15 to-purple-600/10',
    glow: 'shadow-[0_0_30px_rgba(168,85,247,0.25)]',
    border: 'border-purple-500/30',
    headerBg: 'bg-gray-900/95',
    icon: 'text-purple-400',
    userBg: 'bg-purple-600',
    button: 'bg-purple-600 hover:bg-purple-700',
    promptBg: 'bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30',
  };

  const INACTIVITY_HOURS = 24;

  const checkAutoExpiry = (storedId: string): string => {
    const lastActivity = localStorage.getItem('elfie-last-activity');
    if (lastActivity) {
      const hoursSince = (Date.now() - parseInt(lastActivity)) / (1000 * 60 * 60);
      if (hoursSince >= INACTIVITY_HOURS) {
        const newId = `session-${Date.now()}`;
        localStorage.setItem('elfie-session-id', newId);
        localStorage.setItem('elfie-last-activity', String(Date.now()));
        return newId;
      }
    }
    return storedId;
  };

  const [sessionId, setSessionId] = useState<string>(() => {
    const stored = localStorage.getItem('elfie-session-id');
    const id = stored || `session-${Date.now()}`;
    return checkAutoExpiry(id);
  });

  const getWelcomeMessage = () => {
    return `Hello! I'm E.L.F.I.E., your ${dashboardContext} operations assistant. What can I help you with today?`;
  };

  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: getWelcomeMessage() }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [supportTicket, setSupportTicket] = useState<{ id: string; status: string } | null>(null);
  const [escalating, setEscalating] = useState(false);
  const [featureRequestMode, setFeatureRequestMode] = useState(false);
  const [pendingFeature, setPendingFeature] = useState<string | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [showThreadList, setShowThreadList] = useState(false);
  const [threads, setThreads] = useState<{ id: string; sessionId: string; title: string; updatedAt: string }[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(false);
  const lastPollRef = useRef<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const loadThreads = async () => {
    setThreadsLoading(true);
    try {
      const res = await fetch('/api/conversations/threads', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setThreads(data);
      }
    } catch {}
    setThreadsLoading(false);
  };

  const handleNewChat = () => {
    const newId = `session-${Date.now()}`;
    setSessionId(newId);
    localStorage.setItem('elfie-session-id', newId);
    localStorage.setItem('elfie-last-activity', String(Date.now()));
    setMessages([{ role: 'assistant', content: getWelcomeMessage() }]);
    setSupportTicket(null);
    setFeatureRequestMode(false);
    setPendingFeature(null);
    setHistoryLoaded(true);
    setShowThreadList(false);
    lastPollRef.current = 0;
  };

  const handleSwitchThread = async (threadSessionId: string) => {
    setSessionId(threadSessionId);
    localStorage.setItem('elfie-session-id', threadSessionId);
    localStorage.setItem('elfie-last-activity', String(Date.now()));
    setHistoryLoaded(false);
    setShowThreadList(false);
    setSupportTicket(null);
    setFeatureRequestMode(false);
    setPendingFeature(null);
    lastPollRef.current = 0;
  };

  const handleDeleteThread = async (threadSessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/conversations/threads/${encodeURIComponent(threadSessionId)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      setThreads(prev => prev.filter(t => t.sessionId !== threadSessionId));
      if (threadSessionId === sessionId) {
        handleNewChat();
      }
    } catch {}
  };

  // Load conversation history + active ticket on mount
  useEffect(() => {
    if (historyLoaded) return;
    const loadSession = async () => {
      try {
        const res = await fetch(`/api/support/session?sessionId=${encodeURIComponent(sessionId)}`, { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        if (data.messages && data.messages.length > 0) {
          const restored: ChatMessage[] = [
            { role: 'assistant', content: getWelcomeMessage() },
            ...data.messages
              .filter((m: any) => m.role === 'user' || m.role === 'assistant' || m.role === 'support' || m.role === 'system')
              .map((m: any) => ({ role: m.role as ChatMessage['role'], content: m.content })),
          ];
          setMessages(restored);
          if (data.messages.length > 0) {
            const latest = data.messages[data.messages.length - 1];
            lastPollRef.current = new Date(latest.createdAt).getTime();
          }
        }
        if (data.ticket) {
          setSupportTicket({ id: data.ticket.id, status: data.ticket.status });
        }
        if (data.hasUnseenSupport && onSupportNotification) {
          onSupportNotification(true);
        }
      } catch {}
      setHistoryLoaded(true);
    };
    loadSession();
  }, [sessionId, historyLoaded]);

  useEffect(() => {
    if (marketIntel && messages.length === 1 && messages[0].role === 'assistant' && !historyLoaded) {
      setMessages([{ role: 'assistant', content: getWelcomeMessage() }]);
    }
  }, [marketIntel]);

  // Persist session ID and update last activity
  useEffect(() => {
    localStorage.setItem('elfie-session-id', sessionId);
    localStorage.setItem('elfie-last-activity', String(Date.now()));
  }, [sessionId]);

  // Poll for new support/system messages when ticket is active
  useEffect(() => {
    if (!supportTicket || supportTicket.status === 'resolved') return;
    const poll = async () => {
      try {
        const ticketRes = await fetch(`/api/support/ticket-status?sessionId=${encodeURIComponent(sessionId)}`, { credentials: 'include' });
        if (ticketRes.ok) {
          const t = await ticketRes.json();
          if (t) setSupportTicket({ id: t.id, status: t.status });
        }
        const msgsRes = await fetch(`/api/support/messages?sessionId=${encodeURIComponent(sessionId)}&since=${lastPollRef.current}`, { credentials: 'include' });
        if (!msgsRes.ok) return;
        const newMsgs = await msgsRes.json();
        if (newMsgs.length > 0) {
          lastPollRef.current = Math.max(...newMsgs.map((m: any) => new Date(m.createdAt).getTime()));
          let appendedSupport = false;
          setMessages(prev => {
            const seenKeys = new Set(prev.map(m => `${m.role}:${m.content}:${(m as any).createdAt || ''}`));
            const dedupedMsgs: ChatMessage[] = [];
            for (const m of newMsgs) {
              const key = `${m.role}:${m.content}:${m.createdAt || ''}`;
              if (!seenKeys.has(key)) {
                seenKeys.add(key);
                dedupedMsgs.push({ role: m.role as 'support' | 'system', content: m.content });
                if (m.role === 'support') appendedSupport = true;
              }
            }
            if (dedupedMsgs.length === 0) return prev;
            return [...prev, ...dedupedMsgs];
          });
          if (appendedSupport && isMinimized && onSupportNotification) {
            onSupportNotification(true);
          }
        }
      } catch {}
    };
    const interval = setInterval(poll, 5000);
    poll();
    return () => clearInterval(interval);
  }, [supportTicket, sessionId]);

  const handleEscalate = async () => {
    setEscalating(true);
    try {
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      const res = await fetch('/api/support/escalate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          sessionId,
          subject: lastUserMsg?.content?.slice(0, 100) || 'Live support request',
        }),
      });
      if (!res.ok) throw new Error('Failed to escalate');
      const ticket = await res.json();
      setSupportTicket({ id: ticket.id, status: ticket.status });
      lastPollRef.current = Date.now();
      setMessages(prev => [
        ...prev,
        { role: 'system', content: 'This conversation has been escalated to live support. A team member will join shortly.' },
      ]);
      toast({ title: 'Escalated to live support', description: 'A support agent will join this conversation.' });
    } catch {
      toast({ title: 'Could not escalate', description: 'Please try again.', variant: 'destructive' });
    } finally {
      setEscalating(false);
    }
  };

  const handleEnterFeatureMode = () => {
    setFeatureRequestMode(true);
    setPendingFeature(null);
    setMessages(prev => [
      ...prev,
      { role: 'system', content: 'Feature Request Mode' },
      { role: 'assistant', content: "I'd love to hear your idea! Describe the feature you'd like to see in E.L.F.I.E. and I'll help shape it into a clear request." },
    ]);
  };

  const handleExitFeatureMode = () => {
    setFeatureRequestMode(false);
    setPendingFeature(null);
    setMessages(prev => [
      ...prev,
      { role: 'system', content: 'Returned to normal chat' },
    ]);
  };

  const handleFeatureRephrase = async (description: string) => {
    setIsLoading(true);
    setPendingFeature(null);
    const userMsg: ChatMessage = { role: 'user', content: description };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    if (inputRef.current) (inputRef.current as HTMLTextAreaElement).style.height = '40px';

    try {
      const res = await fetch('/api/feature-request/rephrase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ description }),
      });
      if (!res.ok) throw new Error('Failed to rephrase');
      const data = await res.json();
      setPendingFeature(data.rephrased);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Here's how I'd word your request:\n\n**"${data.rephrased}"**\n\nDoes this capture what you want? Type **yes** to submit, or describe it differently and I'll try again.` },
      ]);
    } catch {
      setPendingFeature(description);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `I couldn't rephrase that automatically, but I have your request:\n\n**"${description}"**\n\nType **yes** to submit it as-is, or try describing it differently.` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFeatureConfirm = async () => {
    if (!pendingFeature) return;
    setIsLoading(true);
    setMessages(prev => [...prev, { role: 'user', content: 'Yes, submit it!' }]);

    try {
      const res = await fetch('/api/feature-request/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ feature: pendingFeature }),
      });
      if (!res.ok) throw new Error('Failed to submit');
      const data = await res.json();
      const l2Label = data.l2Name || 'General';
      setPendingFeature(null);
      setFeatureRequestMode(false);
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: `Your feature request has been added to the backlog under **${l2Label}** with a **New** status. The product team will review it soon.\n\nThank you for helping make E.L.F.I.E. better! You can continue chatting normally now.` },
      ]);
      toast({ title: 'Feature request submitted', description: `Added to ${l2Label} backlog` });
    } catch {
      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: "Something went wrong submitting your request. Please try again." },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const scrollToBottom = () => {
    // Never scroll if input is focused (critical for iOS keyboard)
    if (isInputFocused) {
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const checkIfNearBottom = () => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  useEffect(() => {
    const isStreaming = messages.some(m => m.streaming);
    if (isStreaming) {
      if (!checkIfNearBottom()) {
        setShowScrollDown(true);
      }
      return;
    }
    if (!isInputFocused) {
      const timeoutId = setTimeout(() => {
        scrollToBottom();
        setShowScrollDown(false);
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [messages, isInputFocused]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      setShowScrollDown(!nearBottom && messages.some(m => m.streaming));
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [messages]);

  useEffect(() => {
    if (isMinimized) {
      setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m));
    }
  }, [isMinimized]);

  useEffect(() => {
    if (!isMinimized && pendingPrompt) {
      handleSend(pendingPrompt);
      setPendingPrompt(null);
    }
  }, [isMinimized, pendingPrompt]);

  const handleSend = async (message?: string) => {
    const textToSend = message || input;
    if (!textToSend.trim() || isLoading) return;
    localStorage.setItem('elfie-last-activity', String(Date.now()));

    if (featureRequestMode) {
      inputRef.current?.blur();
      const trimmed = textToSend.trim().toLowerCase();
      const isConfirm = pendingFeature && /^(y(es|ep|eah|up)?|sure|ok(ay)?|submit|looks?\s*good|perfect|that('?s| is)\s*(good|right|correct|it|perfect))[\s!.]*$/i.test(trimmed);
      const isCancel = /^(cancel|exit|no|nah|nevermind|never\s*mind|quit|stop)[\s!.]*$/i.test(trimmed);
      if (isConfirm) {
        setInput('');
        handleFeatureConfirm();
      } else if (isCancel) {
        setInput('');
        handleExitFeatureMode();
      } else {
        handleFeatureRephrase(textToSend);
      }
      return;
    }
    
    inputRef.current?.blur();
    if (inputRef.current) (inputRef.current as HTMLTextAreaElement).style.height = '40px';
    
    const userMessage: ChatMessage = { role: 'user', content: textToSend };
    setInput('');
    setIsLoading(true);
    
    const conversationHistory = [...messages, userMessage];
    setMessages(conversationHistory);

    const isHeadlineRequest = /latest headlines|what'?s new|market briefing|show me.*news/i.test(textToSend);

    let cachedNewsArticles: any[] | null = null;
    let cachedForumPosts: any[] | null = null;
    if (isHeadlineRequest && marketIntel) {
      cachedNewsArticles = (marketIntel.news.articles || []).map((a, idx) => ({
        id: idx,
        title: a.title,
        snippet: a.snippet,
        url: a.url,
        source: a.source,
        topic: a.query,
        fetchedAt: a.fetchedAt,
        relevance: '',
      }));
      cachedForumPosts = (marketIntel.forum.posts || []).map((f, idx) => ({
        id: `fp-${idx}`,
        threadId: `ft-${idx}-${f.title.substring(0, 20)}`,
        title: f.title,
        excerpt: f.excerpt,
        username: f.username,
        userFeedbackRating: 0,
        postedAt: f.postedAt,
        postUrl: f.threadUrl,
        threadUrl: f.threadUrl,
        hasReplies: false,
        relevance: '',
      }));
    }
    
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId,
        },
        body: JSON.stringify({
          messages: conversationHistory.slice(-20).map(m => ({
            role: m.role,
            content: m.content,
          })),
          context: dashboardContext,
        }),
      });

      const data = await response.json();

      if (data.sessionId && data.sessionId !== sessionId) {
        setSessionId(data.sessionId);
      }
      
      if (data.error) {
        const errorMessage: ChatMessage = {
          role: 'assistant',
          content: data.message || "I'm having trouble connecting right now. Please try again in a moment.",
        };
        setMessages(prev => [...prev, errorMessage]);
        setIsLoading(false);
        return;
      }

      const msgId = `msg-${Date.now()}`;
      const responseNews = data.marketNewsArticles || [];
      const responseForums = data.forumDiscussions || [];
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.message || "I'm sorry, I couldn't generate a response.",
        messageId: msgId,
        streaming: true,
        items: data.items || [],
        orders: data.orders || [],
        forumDiscussions: responseForums.length > 0 ? responseForums : (cachedForumPosts || []),
        marketNewsArticles: responseNews.length > 0 ? responseNews : (cachedNewsArticles || []),
        bricklinkSearchSuggestion: data.bricklinkSearchSuggestion || null,
        imageUrl: data.bricklinkItem?.imageUrl || data.bricklinkItem?.thumbnailUrl || undefined,
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again in a moment.",
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePromptClick = (prompt: string) => {
    if (onPromptAction) {
      onPromptAction(prompt);
    }
    
    // If minimized, expand and queue the prompt to send after expansion
    if (isMinimized && onToggleMinimize) {
      setPendingPrompt(prompt);
      onToggleMinimize();
    } else {
      // If already expanded, send immediately
      handleSend(prompt);
    }
  };

  const handleSummarize = async (title: string, snippet: string, url: string, type: string = 'news'): Promise<string> => {
    const response = await fetch('/api/ai/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ title, snippet, url, type }),
    });
    if (!response.ok) throw new Error('Failed to summarize');
    const data = await response.json();
    return data.overview || snippet;
  };

  const handleBrickLinkSearch = async (itemNo: string, itemType: string) => {
    try {
      // Call BrickLink search endpoint
      const response = await fetch(`/api/bricklink/search?itemNo=${encodeURIComponent(itemNo)}&itemType=${encodeURIComponent(itemType)}`);
      const data = await response.json();
      
      if (data.error) {
        console.error('🔗 BrickLink search error:', data.error);
        // Add error message to chat
        const errorMessage: ChatMessage = {
          role: 'assistant',
          content: `I couldn't find "${itemNo}" in the BrickLink catalog. ${data.error}`,
        };
        setMessages(prev => [...prev, errorMessage]);
        return;
      }
      
      if (data.item) {
        // Store in sessionStorage for modal to access
        const catalogItemKey = `bricklink-item-${data.item.itemNo}`;
        sessionStorage.setItem(catalogItemKey, JSON.stringify(data.item));
        
        // Add success message to chat
        const successMessage: ChatMessage = {
          role: 'assistant',
          content: `Found "${data.item.itemName}" in the BrickLink catalog! Opening details...`,
        };
        setMessages(prev => [...prev, successMessage]);
        
        // Open modal with catalog item
        if (onItemClick) {
          const catalogItemId = `bricklink-${data.item.itemNo}`;
          onItemClick('inventory', catalogItemId);
        }
      }
    } catch (error) {
      console.error('🔗 BrickLink search error:', error);
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: `I had trouble searching BrickLink. Please try again.`,
      };
      setMessages(prev => [...prev, errorMessage]);
    }
  };

  return (
    <>
    <div 
      className={`flex flex-col relative ${isMinimized ? 'min-h-16' : 'h-full'} border-t-4 ${colors.border} bg-gradient-to-br ${colors.gradient} to-transparent ${colors.glow}`}
    >
      <div 
        className={`flex items-center justify-between gap-2 md:gap-3 lg:gap-4 p-3 md:p-4 lg:p-5 border-b-2 ${colors.border} ${colors.headerBg} backdrop-blur-sm`}
      >
        <div className="flex items-center gap-2 md:gap-3 lg:gap-4 min-w-0 flex-1">
          <div className="flex items-center gap-2 md:gap-3 px-2 md:px-3 py-1 md:py-1.5 rounded-full bg-purple-500/20 border border-purple-500/30 flex-shrink-0">
            <img src={elfieRobot} alt="Elfie Robot" className="h-6 w-6 md:h-8 md:w-8 lg:h-10 lg:w-10 object-contain" />
            <span className="text-sm md:text-lg lg:text-xl font-bold text-purple-300">E.L.F.I.E.</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!isMinimized && (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  handleNewChat();
                }}
                className="h-7 w-7 md:h-8 md:w-8 hover:bg-purple-500/20"
                data-testid="button-new-chat"
                title="New conversation"
              >
                <Plus className={`h-4 w-4 ${colors.icon}`} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowThreadList(!showThreadList);
                  if (!showThreadList) loadThreads();
                }}
                className="h-7 w-7 md:h-8 md:w-8 hover:bg-purple-500/20"
                data-testid="button-thread-list"
                title="Conversation history"
              >
                <History className={`h-4 w-4 ${colors.icon}`} />
              </Button>
            </>
          )}
          {onToggleMinimize && (
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onToggleMinimize();
              }}
              className="h-7 w-7 md:h-10 md:w-10 lg:h-12 lg:w-12 hover:bg-purple-500/20"
              data-testid="button-toggle-chat"
            >
              {isMinimized ? (
                <Maximize2 className={`h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6 ${colors.icon}`} />
              ) : (
                <Minimize2 className={`h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6 ${colors.icon}`} />
              )}
            </Button>
          )}
        </div>
      </div>

      {!isMinimized && (
        <div className={`flex gap-2 px-3 md:px-4 py-2 overflow-x-auto scrollbar-hide border-b border-purple-500/20`}>
          <button
            onClick={() => handlePromptClick('Show me the latest headlines')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all ${colors.promptBg}`}
            data-testid="prompt-latest-news"
          >
            <Newspaper className="h-3 w-3" />
            <span>Latest News</span>
          </button>
          {!featureRequestMode && (
            <button
              onClick={handleEnterFeatureMode}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30"
              data-testid="button-feature-request"
              disabled={isLoading}
            >
              <Lightbulb className="h-3 w-3" />
              <span>Feature Request</span>
            </button>
          )}
          {!supportTicket && !featureRequestMode && (
            <button
              onClick={handleEscalate}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap flex-shrink-0 transition-all bg-green-500/20 hover:bg-green-500/30 text-green-300 border border-green-500/30"
              data-testid="button-escalate"
              disabled={isLoading || escalating || messages.length < 3}
            >
              {escalating ? <RefreshCcw className="h-3 w-3 animate-spin" /> : <Headphones className="h-3 w-3" />}
              <span>Agent Request</span>
            </button>
          )}
        </div>
      )}

      {!isMinimized && showThreadList && (
        <div className="absolute inset-0 top-[auto] z-20 bg-gray-900/95 backdrop-blur-sm flex flex-col" style={{ height: 'calc(100% - 60px)', top: '60px' }}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-purple-500/20">
            <span className="text-sm font-medium text-purple-300">Conversation History</span>
            <Button size="icon" variant="ghost" onClick={() => setShowThreadList(false)} className="h-6 w-6 hover:bg-purple-500/20" data-testid="button-close-threads">
              <X className="h-4 w-4 text-gray-400" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {threadsLoading ? (
              <div className="flex items-center justify-center py-8">
                <RefreshCcw className="h-5 w-5 animate-spin text-purple-400" />
              </div>
            ) : threads.length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-sm">No past conversations</div>
            ) : (
              <div className="space-y-1">
                {threads.map((thread) => (
                  <div
                    key={thread.sessionId}
                    onClick={() => handleSwitchThread(thread.sessionId)}
                    className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-md cursor-pointer transition-colors group ${
                      thread.sessionId === sessionId
                        ? 'bg-purple-500/20 border border-purple-500/30'
                        : 'hover:bg-gray-800/60'
                    }`}
                    data-testid={`thread-${thread.sessionId}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-gray-200 truncate">{thread.title || 'New conversation'}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5">
                        {new Date(thread.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        {' '}
                        {new Date(thread.updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <button
                      onClick={(e) => handleDeleteThread(thread.sessionId, e)}
                      className="invisible group-hover:visible p-1 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 flex-shrink-0"
                      data-testid={`button-delete-thread-${thread.sessionId}`}
                      title="Delete conversation"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="p-3 border-t border-purple-500/20">
            <button
              onClick={handleNewChat}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium transition-colors"
              data-testid="button-new-chat-from-list"
            >
              <Plus className="h-4 w-4" />
              <span>New Conversation</span>
            </button>
          </div>
        </div>
      )}

      {!isMinimized && (
        <>
          <div 
            ref={scrollContainerRef}
            className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto relative" 
            style={{ WebkitOverflowScrolling: 'touch' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4 md:space-y-5 lg:space-y-6">
              {messages.map((message, i) => (
                <div
                  key={message.messageId || i}
                  className={`flex gap-2 md:gap-3 lg:gap-4 ${message.role === 'user' ? 'justify-end' : message.role === 'system' ? 'justify-center' : 'justify-start'}`}
                  data-testid={`message-${message.role}-${i}`}
                >
                  {message.role === 'system' ? (
                    <div className="max-w-[90%] rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-2 text-xs text-amber-300 text-center">
                      {message.content}
                    </div>
                  ) : (
                    <>
                      {message.role === 'assistant' && (
                        <div className="flex-shrink-0">
                          <img src={elfieRobot} alt="Elfie" className="h-8 w-8 md:h-10 md:w-10 lg:h-12 lg:w-12 object-contain" />
                        </div>
                      )}
                      {message.role === 'support' && (
                        <div className="flex-shrink-0 h-8 w-8 md:h-10 md:w-10 lg:h-12 lg:w-12 rounded-full bg-green-600 flex items-center justify-center">
                          <Headphones className="h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6 text-white" />
                        </div>
                      )}
                      <div
                        className={`max-w-[85%] rounded-lg text-sm md:text-base lg:text-lg overflow-hidden ${
                          message.role === 'user'
                            ? colors.userBg + ' text-white p-3 md:p-4 lg:p-5'
                            : message.role === 'support'
                            ? 'bg-green-600/20 border border-green-500/30 text-green-100 p-3 md:p-4 lg:p-5'
                            : 'text-gray-300'
                        }`}
                      >
                        {message.role === 'support' && (
                          <p className="text-[10px] font-semibold text-green-400 mb-1">Support Agent</p>
                        )}
                        {message.role === 'user' ? (
                          message.content
                        ) : message.role === 'support' ? (
                          message.content
                        ) : (
                          <StreamingMessage
                            message={message}
                            onItemClick={onItemClick}
                            onBrickLinkSearch={handleBrickLinkSearch}
                            onPromptClick={handleSend}
                            onSummarize={handleSummarize}
                            onStreamingDone={() => {
                              setMessages(prev => prev.map(m => m.messageId === message.messageId ? { ...m, streaming: false } : m));
                            }}
                          />
                        )}
                      </div>
                    </>
                  )}
                </div>
              ))}
              
              {isLoading && (
                <div className="flex gap-2 md:gap-3 lg:gap-4 justify-start" data-testid="thinking-indicator">
                  <div className="flex-shrink-0">
                    <img src={elfieRobot} alt="Elfie" className="h-8 w-8 md:h-10 md:w-10 lg:h-12 lg:w-12 object-contain" />
                  </div>
                  <div className="flex items-center gap-1.5 pt-2">
                    <span className="h-2 w-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="h-2 w-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="h-2 w-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          </div>

          {showScrollDown && (
            <div className="flex justify-center -mt-1 mb-1 relative z-10">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  scrollToBottom();
                  setShowScrollDown(false);
                }}
                className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-600/80 hover:bg-purple-500/90 text-white text-xs font-medium shadow-lg backdrop-blur-sm transition-all animate-pulse"
                data-testid="button-scroll-down"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                New content below
              </button>
            </div>
          )}
          
          <div className={`border-t-2 ${colors.border} bg-gray-900/50 backdrop-blur-sm`}>
            {featureRequestMode && (
              <div className="flex items-center gap-2 px-3 md:px-4 pt-2 pb-0">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/20 border border-amber-500/30 text-amber-300 text-[10px] md:text-xs font-medium">
                  <Lightbulb className="h-3 w-3" />
                  <span>Feature Request Mode</span>
                </div>
                <button
                  onClick={handleExitFeatureMode}
                  className="text-[10px] text-gray-500 hover:text-gray-300 underline"
                  data-testid="button-exit-feature-mode"
                >
                  exit
                </button>
              </div>
            )}
            {supportTicket && supportTicket.status !== 'resolved' && (
              <div className="flex items-center gap-1.5 px-3 md:px-4 pt-2 pb-0">
                <Headphones className="h-3.5 w-3.5 text-green-400" />
                <span className="text-xs text-green-400">{supportTicket.status === 'active' ? 'Support agent joined' : 'Waiting for agent...'}</span>
              </div>
            )}
            <div className="flex gap-2 md:gap-3 lg:gap-4 p-3 md:p-4 lg:p-5">
              <textarea
                ref={inputRef as any}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                onFocus={(e) => {
                  e.stopPropagation();
                  setIsInputFocused(true);
                }}
                onBlur={() => setIsInputFocused(false)}
                onClick={(e) => e.stopPropagation()}
                placeholder={featureRequestMode ? (pendingFeature ? 'Type "yes" to submit or describe differently...' : 'Describe the feature you want...') : 'Ask E.L.F.I.E. for help...'}
                rows={1}
                className="flex-1 text-sm md:text-base lg:text-lg bg-gray-800/80 border border-purple-500/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-purple-500/50 rounded-md px-3 py-2 resize-none overflow-y-auto text-gray-100 placeholder:text-gray-500 leading-normal"
                style={{ height: '40px', maxHeight: '120px' }}
                data-testid="input-chat"
              />
              <Button 
                size="icon"
                type="button"
                onTouchEnd={(e) => {
                  e.preventDefault();
                  handleSend();
                }}
                onClick={() => {
                  handleSend();
                }}
                className={`${colors.button} md:h-12 md:w-12 lg:h-14 lg:w-14 touch-manipulation`} 
                data-testid="button-send"
                disabled={isLoading}
              >
                {isLoading ? (
                  <RefreshCcw className="h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6" />
                )}
              </Button>
            </div>
          </div>
        </>
      )}

    </div>

    </>
  );
}
