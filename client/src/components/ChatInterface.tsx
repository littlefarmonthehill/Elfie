import { useState, useEffect, useRef } from "react";
import { Send, Bot, RefreshCcw, ChevronUp, ChevronDown, Minimize2, Maximize2, ExternalLink, X, Camera, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InventoryGroup } from "@/components/InventoryGroup";
import { OrderGroup } from "@/components/OrderGroup";
import { ForumDiscussionsGroup } from "@/components/ForumDiscussionsGroup";
import { useToast } from "@/hooks/use-toast";
import elfieRobot from "@assets/PlanetBrick_good_robot_1760672362080.png";

interface ChatMessage {
  role: 'user' | 'assistant';
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
  bricklinkSearchSuggestion?: {
    itemNo: string;
    itemType: string;
  } | null;
  onItemClick?: (type: 'inventory' | 'order', id: string) => void;
  onBrickLinkClick?: (url: string) => void;
  onBrickLinkSearch?: (itemNo: string, itemType: string) => void;
}

function MessageContent({ content, imageUrl, items, orders, forumDiscussions, bricklinkSearchSuggestion, onItemClick, onBrickLinkClick, onBrickLinkSearch }: MessageContentProps) {
  // Group items by itemNo for grouped display
  const groupedItems = items && items.length > 0 ? items.reduce((acc, item) => {
    if (!acc[item.itemNo]) {
      acc[item.itemNo] = [];
    }
    acc[item.itemNo].push(item);
    return acc;
  }, {} as Record<string, typeof items>) : null;

  // Parse markdown bullet points and create clickable elements
  const parseContent = (text: string) => {
    const lines = text.split('\n');
    const elements: JSX.Element[] = [];
    let currentParagraph: string[] = [];
    let key = 0;

    const flushParagraph = () => {
      if (currentParagraph.length > 0) {
        const paraText = currentParagraph.join('\n');
        elements.push(
          <p key={`para-${key++}`} className="mb-2">
            {parseInlineContent(paraText)}
          </p>
        );
        currentParagraph = [];
      }
    };

    const parseInlineContent = (text: string) => {
      const parts: (string | JSX.Element)[] = [];
      let lastIndex = 0;

      // Match markdown links: [text](url) AND bare URLs: https://...
      // Markdown format takes priority
      const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
      const bareUrlRegex = /https?:\/\/[^\s)]+/g;
      
      // First pass: Find all markdown links
      const markdownMatches: Array<{ start: number; end: number; text: string; url: string }> = [];
      let mdMatch;
      while ((mdMatch = markdownLinkRegex.exec(text)) !== null) {
        markdownMatches.push({
          start: mdMatch.index,
          end: mdMatch.index + mdMatch[0].length,
          text: mdMatch[1],
          url: mdMatch[2]
        });
      }
      
      // Second pass: Find bare URLs that aren't inside markdown links
      const allMatches: Array<{ start: number; end: number; text: string | null; url: string }> = [...markdownMatches];
      let bareMatch: RegExpExecArray | null;
      while ((bareMatch = bareUrlRegex.exec(text)) !== null) {
        const isCoveredByMarkdown = markdownMatches.some(
          md => bareMatch!.index >= md.start && bareMatch!.index < md.end
        );
        if (!isCoveredByMarkdown) {
          allMatches.push({
            start: bareMatch.index,
            end: bareMatch.index + bareMatch[0].length,
            text: null,
            url: bareMatch[0]
          });
        }
      }
      
      // Sort by position
      allMatches.sort((a, b) => a.start - b.start);
      
      // Build the result
      allMatches.forEach((match, idx) => {
        // Add text before this match
        if (match.start > lastIndex) {
          const beforeText = text.substring(lastIndex, match.start);
          parts.push(...parsePartNumbers(beforeText));
        }
        
        const displayText = match.text || getShortUrlText(match.url);
        
        // On iOS: Opens in-app Safari sheet with "Done" button (stays in app)
        // On Desktop: Opens in new tab
        const handleLinkClick = (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          window.open(match.url, '_blank', 'noopener,noreferrer');
        };
        
        parts.push(
          <button
            key={`url-${idx}`}
            onClick={handleLinkClick}
            className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300 underline"
            data-testid={`link-${displayText.toLowerCase().replace(/\s+/g, '-')}`}
          >
            {displayText}
            <ExternalLink className="h-3 w-3" />
          </button>
        );
        
        lastIndex = match.end;
      });

      // Add remaining text
      if (lastIndex < text.length) {
        parts.push(...parsePartNumbers(text.substring(lastIndex)));
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

    lines.forEach((line, index) => {
      // Check if line is a bullet point
      if (line.trim().startsWith('- ') || line.trim().startsWith('• ')) {
        flushParagraph();
        const bulletText = line.trim().substring(2);
        elements.push(
          <li key={`bullet-${key++}`} className="ml-4 mb-1">
            {parseInlineContent(bulletText)}
          </li>
        );
      } else if (line.trim() === '') {
        flushParagraph();
      } else {
        currentParagraph.push(line);
      }
    });

    flushParagraph();

    return elements;
  };

  return (
    <div className="w-full space-y-2">
      {/* Show identified LEGO part image from Brickognize */}
      {imageUrl && (
        <div className="flex justify-center">
          <img 
            src={imageUrl} 
            alt="Identified LEGO part" 
            className="max-w-[200px] max-h-[200px] object-contain rounded-lg border border-purple-500/30 bg-gray-900/50"
            data-testid="img-brickognize-result"
            onError={(e) => {
              // Hide image if it fails to load
              e.currentTarget.style.display = 'none';
            }}
          />
        </div>
      )}
      
      {/* Always show the AI's text response when present */}
      {content && content.trim().length > 0 && (
        <div className="space-y-1 bg-gray-800/80 text-gray-300 border border-purple-500/20 p-3 rounded-lg">
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
      
      {/* Show forum discussions if available */}
      {forumDiscussions && forumDiscussions.length > 0 && (
        <ForumDiscussionsGroup
          discussions={forumDiscussions}
          onExternalLinkClick={onBrickLinkClick}
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

interface ChatInterfaceProps {
  dashboardContext: string;
  themeColor: 'red' | 'blue' | 'yellow' | 'green' | 'orange' | 'purple';
  prompts: string[];
  onPromptAction?: (prompt: string) => void;
  onItemClick?: (type: 'inventory' | 'order' | 'sales' | 'marketing', id: string) => void;
  isMinimized?: boolean;
  onToggleMinimize?: () => void;
  onThinkingChange?: (isThinking: boolean) => void;
}

export default function ChatInterface({ dashboardContext, themeColor, prompts, onPromptAction, onItemClick, isMinimized = true, onToggleMinimize, onThinkingChange }: ChatInterfaceProps) {
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

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: `Hello! I'm E.L.F.I.E., your ${dashboardContext} operations assistant. How can I help you optimize your LEGO business today?`
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

  // Persist session ID
  useEffect(() => {
    localStorage.setItem('elfie-session-id', sessionId);
  }, [sessionId]);
  
  // Swipe gesture handling
  const touchStartY = useRef<number>(0);
  const touchEndY = useRef<number>(0);

  const scrollToBottom = () => {
    // Never scroll if input is focused (critical for iOS keyboard)
    if (isInputFocused) {
      return;
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    // Only scroll when messages change AND input is not focused
    if (!isInputFocused) {
      const timeoutId = setTimeout(() => {
        scrollToBottom();
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [messages, isInputFocused]);

  // Send pending prompt when chat expands
  useEffect(() => {
    if (!isMinimized && pendingPrompt) {
      handleSend(pendingPrompt);
      setPendingPrompt(null);
    }
  }, [isMinimized, pendingPrompt]);

  // Notify parent when thinking state changes
  useEffect(() => {
    onThinkingChange?.(isLoading);
  }, [isLoading, onThinkingChange]);

  const handleSend = async (message?: string) => {
    const textToSend = message || input;
    if (!textToSend.trim() || isLoading) return;
    
    const userMessage: ChatMessage = { role: 'user', content: textToSend };
    setInput('');
    setIsLoading(true);
    
    // Build conversation history with the new user message
    const conversationHistory = [...messages, userMessage];
    setMessages(conversationHistory);
    
    console.log('🚀 Frontend sending to /api/chat:');
    console.log('  - User message:', textToSend);
    console.log('  - Number of messages in history:', conversationHistory.length);
    console.log('  - Dashboard context:', dashboardContext);
    
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId, // Send session ID for conversation continuity
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

      // Update session ID if server provides a new one
      if (data.sessionId && data.sessionId !== sessionId) {
        setSessionId(data.sessionId);
      }
      
      console.log('📥 Frontend received response:');
      console.log('  - Status:', response.status);
      console.log('  - Message preview:', data.message?.substring(0, 150));
      console.log('  - Items found:', data.items?.length || 0);
      
      if (data.error) {
        // Use the specific error message from the server if provided
        const errorMessage: ChatMessage = {
          role: 'assistant',
          content: data.message || "I'm having trouble connecting right now. Please try again in a moment.",
        };
        setMessages(prev => [...prev, errorMessage]);
        setIsLoading(false);
        return;
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.message || "I'm sorry, I couldn't generate a response.",
        items: data.items || [],
        orders: data.orders || [],
        forumDiscussions: data.forumDiscussions || [],
        bricklinkSearchSuggestion: data.bricklinkSearchSuggestion || null,
      };

      setMessages(prev => [...prev, assistantMessage]);
      
      // Legacy: If BrickLink catalog item is returned, open the detail modal immediately
      if (data.bricklinkItem && onItemClick) {
        console.log('🔗 BrickLink catalog item found, opening modal:', data.bricklinkItem);
        
        // Store BrickLink catalog item in sessionStorage so the modal can access it
        const catalogItemKey = `bricklink-item-${data.bricklinkItem.itemNo}`;
        sessionStorage.setItem(catalogItemKey, JSON.stringify(data.bricklinkItem));
        
        // Use a special ID format to indicate it's from BrickLink catalog
        const catalogItemId = `bricklink-${data.bricklinkItem.itemNo}`;
        
        // Trigger modal with the catalog item data
        onItemClick('inventory', catalogItemId);
      }
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

  const handleBrickLinkSearch = async (itemNo: string, itemType: string) => {
    console.log('🔗 Searching BrickLink catalog for:', itemNo, 'type:', itemType);
    
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
        console.log('🔗 BrickLink catalog item found:', data.item);
        
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

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = () => {
    if (!onToggleMinimize) return;
    
    const swipeDistance = touchStartY.current - touchEndY.current;
    const minSwipeDistance = 50; // Minimum pixels to trigger swipe
    
    // Swipe up to expand (when minimized)
    if (isMinimized && swipeDistance > minSwipeDistance) {
      onToggleMinimize();
    }
    // Swipe down to minimize (when expanded)
    else if (!isMinimized && swipeDistance < -minSwipeDistance) {
      onToggleMinimize();
    }
    
    touchStartY.current = 0;
    touchEndY.current = 0;
  };

  return (
    <div 
      className={`flex flex-col ${isMinimized ? 'min-h-16' : 'h-full'} border-t-4 ${colors.border} bg-gradient-to-br ${colors.gradient} to-transparent ${colors.glow}`}
    >
      <div 
        className={`flex items-center justify-between gap-2 p-3 border-b-2 ${colors.border} ${colors.headerBg} backdrop-blur-sm`}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-purple-500/20 border border-purple-500/30">
            <img 
              src={elfieRobot} 
              alt="Elfie Robot" 
              className="h-6 w-6 md:h-7 md:w-7 lg:h-8 lg:w-8 object-contain"
            />
            <span className="text-sm font-bold text-purple-300">E.L.F.I.E.</span>
          </div>
          <span className="text-xs text-gray-400">AI Assistant</span>
        </div>
        {onToggleMinimize && (
          <Button
            size="icon"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              onToggleMinimize();
            }}
            className="h-7 w-7 hover:bg-purple-500/20"
            data-testid="button-toggle-chat"
          >
            {isMinimized ? (
              <Maximize2 className={`h-4 w-4 ${colors.icon}`} />
            ) : (
              <Minimize2 className={`h-4 w-4 ${colors.icon}`} />
            )}
          </Button>
        )}
      </div>
      
      {/* Show messages and input only when expanded */}
      {!isMinimized && (
        <>
          {/* Use native scrolling to avoid iOS keyboard issues */}
          <div 
            className="flex-1 p-4 overflow-y-auto" 
            style={{ WebkitOverflowScrolling: 'touch' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-4">
              {messages.map((message, i) => (
                <div
                  key={i}
                  className={`flex gap-2 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  data-testid={`message-${message.role}-${i}`}
                >
                  {/* Show Elfie avatar for assistant messages */}
                  {message.role === 'assistant' && (
                    <div className="flex-shrink-0">
                      <img 
                        src={elfieRobot} 
                        alt="Elfie" 
                        className="h-8 w-8 md:h-9 md:w-9 lg:h-10 lg:w-10 object-contain"
                      />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-lg text-sm ${
                      message.role === 'user'
                        ? colors.userBg + ' text-white p-3'
                        : 'text-gray-300' // Assistant messages - MessageContent handles its own styling
                    }`}
                  >
                    {message.role === 'user' ? (
                      message.content
                    ) : (
                      <MessageContent
                        content={message.content}
                        imageUrl={message.imageUrl}
                        items={message.items}
                        orders={message.orders}
                        forumDiscussions={message.forumDiscussions}
                        bricklinkSearchSuggestion={message.bricklinkSearchSuggestion}
                        onItemClick={onItemClick}
                        onBrickLinkClick={undefined}
                        onBrickLinkSearch={handleBrickLinkSearch}
                      />
                    )}
                  </div>
                </div>
              ))}
              
              {/* Thinking indicator when loading */}
              {isLoading && (
                <div className="flex gap-2 justify-start" data-testid="thinking-indicator">
                  <div className="flex-shrink-0">
                    <img 
                      src={elfieRobot} 
                      alt="Elfie thinking" 
                      className="h-8 w-8 md:h-9 md:w-9 lg:h-10 lg:w-10 object-contain animate-bounce"
                    />
                  </div>
                  <div className="max-w-[80%] rounded-lg p-3 bg-purple-500/10 border border-purple-500/20">
                    <div className="flex items-center gap-2 text-xs text-purple-300">
                      <span>E.L.F.I.E. is thinking</span>
                      <div className="flex gap-1">
                        <span className="animate-pulse">.</span>
                        <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>.</span>
                        <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>.</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>
          </div>
          
          <div className={`border-t-2 ${colors.border} bg-gray-900/50 backdrop-blur-sm`}>
            <div className="flex gap-2 p-3">
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
                className="text-purple-400 hover:text-purple-300 hover:bg-purple-500/20"
                data-testid="button-camera"
                disabled={isLoading}
                title="Take photo or upload image"
              >
                <Camera className="h-4 w-4" />
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
                className="text-sm bg-gray-800/80 border-purple-500/30 focus-visible:ring-purple-500/50"
                data-testid="input-chat"
              />
              <Button 
                size="icon" 
                onClick={(e) => {
                  e.stopPropagation();
                  handleSend();
                }}
                className={colors.button} 
                data-testid="button-send"
                disabled={isLoading}
              >
                {isLoading ? (
                  <RefreshCcw className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Always show prompts */}
      {prompts.length > 0 && (
        <div className={`flex gap-2 flex-wrap p-3 ${!isMinimized ? 'border-t border-purple-500/20' : ''}`}>
          {prompts.map((prompt) => (
            <button
              key={prompt}
              onClick={() => handlePromptClick(prompt)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${colors.promptBg}`}
              data-testid={`prompt-${prompt.toLowerCase().replace(/\s/g, '-')}`}
            >
              {prompt}
            </button>
          ))}
        </div>
      )}

    </div>
  );
}
