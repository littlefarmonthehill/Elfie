import { useState, useEffect, useRef } from "react";
import { Send, RefreshCcw, Minimize2, Maximize2, ExternalLink, Camera, Sparkles, Brain, ChevronDown, ChevronRight, Globe, Clock, Newspaper, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

function themeMatchScore(theme: string, text: string): number {
  const tl = theme.toLowerCase();
  const tgt = text.toLowerCase();
  const keywords = tl.split(/[\s&,]+/).filter(w => w.length > 3);
  return keywords.filter(w => tgt.includes(w)).length;
}

interface ChatMessage {
  role: 'user' | 'assistant';
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

  const flushThemeCards = (elements: JSX.Element[], keyRef: { value: number }) => {
    if (!currentThemeText) return;
    const isForumTheme = /community|forum|discussion|chatter|buzz|thread/i.test(currentThemeText);

    const matchingNews = allNewsCards.filter(a => !matchedNewsIds.has(a.id) && themeMatchScore(currentThemeText, `${a.title} ${a.topic || ''}`) > 0);
    matchingNews.forEach(a => {
      matchedNewsIds.add(a.id);
      themedCardsInjected = true;
      elements.push(
        <InlineNewsCard key={`tnews-${keyRef.value++}`} type="news" title={a.title} snippet={a.snippet} url={a.url} source={a.source} onSummarize={onSummarize} />
      );
    });

    if (isForumTheme) {
      dedupedForums.filter(f => !matchedForumIds.has(f.id)).forEach(f => {
        matchedForumIds.add(f.id);
        themedCardsInjected = true;
        elements.push(
          <InlineNewsCard key={`tforum-${keyRef.value++}`} type="forum" title={f.title} snippet={f.excerpt || undefined} url={f.threadUrl} username={f.username} replyCount={f.replyCount} onSummarize={onSummarize} />
        );
      });
    }
  };

  // Parse markdown bullet points and create clickable elements
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
        elements.push(
          <div key={`header-${key++}`} className="text-xs font-semibold text-purple-300 uppercase tracking-wider mt-3 mb-1.5 border-b border-purple-500/20 pb-1">
            {parseInlineContent(headerText)}
          </div>
        );
      } else if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
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
        currentParagraph.push(line);
      }
    });

    flushStats();
    flushParagraph();
    flushThemeCards(elements, keyRef);

    const unmatchedNews = allNewsCards.filter(a => !matchedNewsIds.has(a.id));
    const unmatchedForums = dedupedForums.filter(f => !matchedForumIds.has(f.id));
    if (unmatchedNews.length > 0 || unmatchedForums.length > 0) {
      if (themedCardsInjected) {
        elements.push(
          <div key={`header-other-${key++}`} className="text-xs font-semibold text-purple-300 uppercase tracking-wider mt-3 mb-1.5 border-b border-purple-500/20 pb-1">
            Other News
          </div>
        );
      }
      unmatchedNews.forEach(a => {
        elements.push(
          <InlineNewsCard key={`unews-${keyRef.value++}`} type="news" title={a.title} snippet={a.snippet} url={a.url} source={a.source} onSummarize={onSummarize} />
        );
      });
      unmatchedForums.forEach(f => {
        elements.push(
          <InlineNewsCard key={`uforum-${keyRef.value++}`} type="forum" title={f.title} snippet={f.excerpt || undefined} url={f.threadUrl} username={f.username} replyCount={f.replyCount} onSummarize={onSummarize} />
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
  const lines = message.content.split('\n');
  const [revealedCount, setRevealedCount] = useState(message.streaming ? 0 : lines.length);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!message.streaming) {
      setRevealedCount(lines.length);
      return;
    }
    setRevealedCount(0);
    doneRef.current = false;
    let idx = 0;
    let cancelled = false;

    const revealNext = () => {
      if (cancelled) return;
      idx = Math.min(idx + 1, lines.length);
      setRevealedCount(idx);
      if (idx >= lines.length) {
        if (!doneRef.current) {
          doneRef.current = true;
          onStreamingDone?.();
        }
        return;
      }
      const currentLine = lines[idx - 1] || '';
      const wordCount = currentLine.trim().split(/\s+/).filter(Boolean).length;
      const charCount = currentLine.trim().length;
      const delay = wordCount === 0 ? 300 : Math.max(600, Math.min(charCount * 25, 3000));
      setTimeout(revealNext, delay);
    };

    setTimeout(revealNext, 300);
    return () => { cancelled = true; };
  }, [message.content, message.streaming]);

  const revealedContent = lines.slice(0, revealedCount).join('\n');

  return (
    <MessageContent
      content={revealedContent}
      imageUrl={message.imageUrl}
      items={message.items}
      orders={message.orders}
      forumDiscussions={message.forumDiscussions}
      marketNewsArticles={message.marketNewsArticles}
      bricklinkSearchSuggestion={message.bricklinkSearchSuggestion}
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
}

export default function ChatInterface({ dashboardContext, themeColor, prompts, onPromptAction, onItemClick, isMinimized = true, onToggleMinimize, marketIntel }: ChatInterfaceProps) {
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

  // Initialize or retrieve session ID for conversation continuity
  const [sessionId, setSessionId] = useState<string>(() => {
    const stored = localStorage.getItem('elfie-session-id');
    return stored || `session-${Date.now()}`;
  });

  const getWelcomeMessage = () => {
    let msg = `Hello! I'm E.L.F.I.E., your ${dashboardContext} operations assistant. How can I help you optimize your LEGO business today?`;

    const hasNews = marketIntel && marketIntel.news.count > 0;
    const hasForum = marketIntel && marketIntel.forum.count > 0;

    if (hasNews || hasForum) {
      const parts: string[] = [];
      if (hasNews) parts.push(`${marketIntel!.news.count} market news update${marketIntel!.news.count === 1 ? '' : 's'}`);
      if (hasForum) parts.push(`${marketIntel!.forum.count} forum discussion${marketIntel!.forum.count === 1 ? '' : 's'}`);
      msg += `\n\nI've got ${parts.join(' and ')} from this week.`;
      msg += `\n**PROMPT:** "Show me the latest headlines"`;
    }

    return msg;
  };

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: getWelcomeMessage()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (marketIntel && messages.length === 1 && messages[0].role === 'assistant') {
      setMessages([{ role: 'assistant', content: getWelcomeMessage() }]);
    }
  }, [marketIntel]);

  // Persist session ID
  useEffect(() => {
    localStorage.setItem('elfie-session-id', sessionId);
  }, [sessionId]);
  

  const scrollToBottom = () => {
    // Never scroll if input is focused (critical for iOS keyboard)
    if (isInputFocused) {
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (!isInputFocused) {
      const timeoutId = setTimeout(() => {
        scrollToBottom();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [messages, isInputFocused]);

  useEffect(() => {
    const isStreaming = messages.some(m => m.streaming);
    if (!isStreaming || isInputFocused || isMinimized) return;
    const interval = setInterval(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 200);
    return () => clearInterval(interval);
  }, [messages, isInputFocused, isMinimized]);

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
    
    inputRef.current?.blur();
    
    const userMessage: ChatMessage = { role: 'user', content: textToSend };
    setInput('');
    setIsLoading(true);
    
    const conversationHistory = [...messages, userMessage];
    setMessages(conversationHistory);

    const isHeadlineRequest = /latest headlines|what'?s new|market briefing|show me.*news/i.test(textToSend);
    const previewId = `preview-${Date.now()}`;

    if (isHeadlineRequest && marketIntel) {
      const newsArticles = (marketIntel.news.articles || []).map((a, idx) => ({
        id: idx,
        title: a.title,
        snippet: a.snippet,
        url: a.url,
        source: a.source,
        topic: a.query,
        fetchedAt: a.fetchedAt,
        relevance: '',
      }));
      const forumPosts = (marketIntel.forum.posts || []).map((f, idx) => ({
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

      const previewMsg: ChatMessage = {
        role: 'assistant',
        messageId: previewId,
        content: `Here's what I found this week — Elfie is analyzing the details now...\n\n### Market News\nLatest articles from around the web.\n\n### Community Discussions\nWhat the BrickLink community is talking about.`,
        marketNewsArticles: newsArticles,
        forumDiscussions: forumPosts,
        streaming: true,
      };
      setMessages(prev => [...prev, previewMsg]);
    }
    
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId,
        },
        body: JSON.stringify({
          messages: conversationHistory.map(m => ({
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
        setMessages(prev => {
          const filtered = prev.filter(m => m.messageId !== previewId);
          return [...filtered, errorMessage];
        });
        setIsLoading(false);
        return;
      }

      const msgId = `msg-${Date.now()}`;
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.message || "I'm sorry, I couldn't generate a response.",
        messageId: msgId,
        streaming: true,
        items: data.items || [],
        orders: data.orders || [],
        forumDiscussions: data.forumDiscussions || [],
        marketNewsArticles: data.marketNewsArticles || [],
        bricklinkSearchSuggestion: data.bricklinkSearchSuggestion || null,
        imageUrl: data.bricklinkItem?.imageUrl || data.bricklinkItem?.thumbnailUrl || undefined,
      };

      setMessages(prev => {
        const filtered = prev.filter(m => m.messageId !== previewId);
        return [...filtered, assistantMessage];
      });
    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: "I'm having trouble connecting right now. Please try again in a moment.",
      };
      setMessages(prev => {
        const filtered = prev.filter(m => m.messageId !== previewId);
        return [...filtered, errorMessage];
      });
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

  const handleImageUpload = async (file: File) => {
    if (!file) return;
    
    setIsLoading(true);
    
    try {
      // Create FormData and append the image
      const formData = new FormData();
      formData.append('image', file);
      formData.append('itemType', 'parts'); // Default to parts
      
      // Call Brickognize API
      const response = await fetch('/api/brickognize/identify', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        throw new Error('Failed to identify LEGO item');
      }
      
      const data = await response.json();
      
      // Format results for chat and check inventory
      if (data.items && data.items.length > 0) {
        const topResult = data.items[0]; // Get the best match
        const topResultId = topResult.id;
        const confidence = Math.round(topResult.score * 100);
        
        // Check if this part exists in inventory
        try {
          const inventoryResponse = await fetch(`/api/inventory?search=${topResultId}`);
          const inventoryData = await inventoryResponse.json();
          
          if (inventoryData && inventoryData.length > 0) {
            // Part found in inventory - show it immediately
            const totalColors = new Set(inventoryData.map((item: any) => item.colorId)).size;
            let resultMessage = `I identified this as **${topResult.name}** (Part ${topResult.id}) with ${confidence}% confidence.\n\nFound in your inventory: ${inventoryData.length} variant${inventoryData.length > 1 ? 's' : ''} across ${totalColors} color${totalColors > 1 ? 's' : ''}.`;
            
            const assistantMessage: ChatMessage = {
              role: 'assistant',
              content: resultMessage,
              imageUrl: topResult.img_url, // Include image from Brickognize
              items: inventoryData, // Include all items for display
            };
            
            setMessages(prev => [...prev, assistantMessage]);
            
            toast({
              title: "Part Identified!",
              description: `Found ${topResult.name} in your inventory!`,
            });
          } else {
            // Part not in inventory - show BrickLink link with proper URL pattern
            const topResults = data.items.slice(0, 5);
            let resultMessage = `I identified this as **${topResult.name}** (Part ${topResult.id}) with ${confidence}% confidence.\n\nThis part is not currently in your inventory.\n\n`;
            
            if (topResults.length > 1) {
              resultMessage += `Other possible matches:\n`;
              topResults.slice(1).forEach((item: any, index: number) => {
                const itemConfidence = Math.round(item.score * 100);
                resultMessage += `${index + 2}. ${item.name} (${item.id}) - ${itemConfidence}% match\n`;
              });
              resultMessage += `\n`;
            }
            
            resultMessage += `Click below to view Part ${topResult.id} on BrickLink:`;
            
            // Construct proper BrickLink URL
            const bricklinkUrl = `https://www.bricklink.com/v2/catalog/catalogitem.page?P=${topResult.id}`;
            resultMessage += `\n[View on BrickLink](${bricklinkUrl})`;
            
            const assistantMessage: ChatMessage = {
              role: 'assistant',
              content: resultMessage,
              imageUrl: topResult.img_url, // Include image from Brickognize
            };
            
            setMessages(prev => [...prev, assistantMessage]);
            
            toast({
              title: "Part Identified!",
              description: `Found ${topResult.name} - not in your inventory`,
            });
          }
        } catch (inventoryError) {
          console.error('Error checking inventory:', inventoryError);
          // Fall back to showing results without inventory check
          const topResults = data.items.slice(0, 5);
          let resultMessage = `I found ${data.items.length} possible matches for your image:\n\n`;
          
          topResults.forEach((item: any, index: number) => {
            const itemConfidence = Math.round(item.score * 100);
            resultMessage += `${index + 1}. ${item.name} (${item.id}) - ${itemConfidence}% match\n`;
          });
          
          const assistantMessage: ChatMessage = {
            role: 'assistant',
            content: resultMessage,
            imageUrl: topResults[0]?.img_url, // Include image from top result
          };
          
          setMessages(prev => [...prev, assistantMessage]);
        }
      } else {
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: "I couldn't identify any LEGO parts in that image. Try taking a clearer photo with good lighting.",
        };
        setMessages(prev => [...prev, assistantMessage]);
      }
    } catch (error) {
      console.error('Image upload error:', error);
      toast({
        title: "Image Recognition Failed",
        description: "E.L.F.I.E. couldn't identify that piece. Try a clearer photo!",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleImageUpload(file);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };


  return (
    <>
    <div 
      className={`flex flex-col ${isMinimized ? 'min-h-16' : 'h-full'} border-t-4 ${colors.border} bg-gradient-to-br ${colors.gradient} to-transparent ${colors.glow}`}
    >
      <div 
        className={`flex items-center justify-between gap-2 md:gap-3 lg:gap-4 p-3 md:p-4 lg:p-5 border-b-2 ${colors.border} ${colors.headerBg} backdrop-blur-sm`}
      >
        <div className="flex items-center gap-2 md:gap-3 lg:gap-4">
          <div className="flex items-center gap-2 md:gap-3 px-2 md:px-3 py-1 md:py-1.5 rounded-full bg-purple-500/20 border border-purple-500/30">
            <img src={elfieRobot} alt="Elfie Robot" className="h-6 w-6 md:h-8 md:w-8 lg:h-10 lg:w-10 object-contain" />
            <span className="text-sm md:text-lg lg:text-xl font-bold text-purple-300">E.L.F.I.E.</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border bg-purple-500/20 border-purple-500/30 text-purple-300"
            data-testid="badge-elfie-mode"
          >
            <Brain className="w-3 h-3" />
            <span>AI Mode</span>
          </div>
        </div>
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
      
      {/* Show messages and input only when expanded */}
      {!isMinimized && (
        <>
          {/* Use native scrolling to avoid iOS keyboard issues */}
          <div 
            className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto" 
            style={{ WebkitOverflowScrolling: 'touch' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4 md:space-y-5 lg:space-y-6">
              {messages.map((message, i) => (
                <div
                  key={message.messageId || i}
                  className={`flex gap-2 md:gap-3 lg:gap-4 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  data-testid={`message-${message.role}-${i}`}
                >
                  {/* Show Elfie avatar for assistant messages */}
                  {message.role === 'assistant' && (
                    <div className="flex-shrink-0">
                      <img src={elfieRobot} alt="Elfie" className="h-8 w-8 md:h-10 md:w-10 lg:h-12 lg:w-12 object-contain" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] rounded-lg text-sm md:text-base lg:text-lg overflow-hidden ${
                      message.role === 'user'
                        ? colors.userBg + ' text-white p-3 md:p-4 lg:p-5'
                        : 'text-gray-300'
                    }`}
                  >
                    {message.role === 'user' ? (
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
          
          <div className={`border-t-2 ${colors.border} bg-gray-900/50 backdrop-blur-sm`}>
            <div className="flex gap-2 md:gap-3 lg:gap-4 p-3 md:p-4 lg:p-5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
                data-testid="input-file"
              />
              <Button 
                size="icon" 
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                variant="ghost"
                className="text-purple-400 hover:text-purple-300 hover:bg-purple-500/20 md:h-12 md:w-12 lg:h-14 lg:w-14"
                data-testid="button-camera"
                disabled={isLoading}
                title="Take photo or upload image"
              >
                <Camera className="h-4 w-4 md:h-5 md:w-5 lg:h-6 lg:w-6" />
              </Button>
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                onFocus={(e) => {
                  e.stopPropagation();
                  setIsInputFocused(true);
                }}
                onBlur={() => setIsInputFocused(false)}
                onClick={(e) => e.stopPropagation()}
                placeholder="Ask E.L.F.I.E. for help..."
                className="text-sm md:text-base lg:text-lg bg-gray-800/80 border-purple-500/30 focus-visible:ring-purple-500/50"
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

      {/* Always show prompts */}
      {prompts.length > 0 && (
        <div className={`flex gap-2 md:gap-3 lg:gap-4 flex-wrap p-3 md:p-4 lg:p-5 ${!isMinimized ? 'border-t border-purple-500/20' : ''}`}>
          {prompts.map((prompt) => (
            <button
              key={prompt}
              onClick={() => handlePromptClick(prompt)}
              className={`px-3 md:px-4 lg:px-5 py-1.5 md:py-2 lg:py-2.5 rounded-full text-xs md:text-sm lg:text-base font-medium transition-all ${colors.promptBg}`}
              data-testid={`prompt-${prompt.toLowerCase().replace(/\s/g, '-')}`}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

    </div>

    </>
  );
}
