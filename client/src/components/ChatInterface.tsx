import { useState, useEffect, useRef } from "react";
import { Send, Bot, RefreshCcw, ChevronUp, ChevronDown, Minimize2, Maximize2, ExternalLink, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InventoryGroup } from "@/components/InventoryGroup";
import { OrderGroup } from "@/components/OrderGroup";
import elfieRobot from "@assets/PlanetBrick_good_robot_1760672362080.png";

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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
  bricklinkSearchSuggestion?: {
    itemNo: string;
    itemType: string;
  } | null;
}

interface MessageContentProps {
  content: string;
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
  bricklinkSearchSuggestion?: {
    itemNo: string;
    itemType: string;
  } | null;
  onItemClick?: (type: 'inventory' | 'order', id: string) => void;
  onBrickLinkClick?: (url: string) => void;
  onBrickLinkSearch?: (itemNo: string, itemType: string) => void;
}

function MessageContent({ content, items, orders, bricklinkSearchSuggestion, onItemClick, onBrickLinkClick, onBrickLinkSearch }: MessageContentProps) {
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

      // Match BrickLink URLs
      const urlRegex = /https:\/\/www\.bricklink\.com\/[^\s)]+/g;
      let match;

      while ((match = urlRegex.exec(text)) !== null) {
        // Add text before the URL
        if (match.index > lastIndex) {
          const beforeText = text.substring(lastIndex, match.index);
          parts.push(...parsePartNumbers(beforeText));
        }

        // Add clickable URL
        const url = match[0];
        parts.push(
          <button
            key={`url-${match.index}`}
            onClick={() => onBrickLinkClick?.(url)}
            className="inline-flex items-center gap-1 text-purple-400 hover:text-purple-300 underline"
          >
            View on BrickLink
            <ExternalLink className="h-3 w-3" />
          </button>
        );

        lastIndex = match.index + url.length;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        parts.push(...parsePartNumbers(text.substring(lastIndex)));
      }

      return parts.length > 0 ? parts : text;
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
      {/* Only show text content if there are no grouped items or orders */}
      {!groupedItems && !orders?.length && (
        <div className="space-y-1">{parseContent(content)}</div>
      )}
      
      {/* Show grouped inventory items if available */}
      {groupedItems && Object.entries(groupedItems).map(([itemNo, items]) => (
        <InventoryGroup
          key={itemNo}
          itemNo={itemNo}
          items={items}
          onItemClick={(id) => onItemClick?.('inventory', id.toString())}
        />
      ))}
      
      {/* Show orders if available */}
      {orders && orders.length > 0 && (
        <OrderGroup
          orders={orders}
          onOrderClick={(id) => onItemClick?.('order', id)}
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
}

export default function ChatInterface({ dashboardContext, themeColor, prompts, onPromptAction, onItemClick, isMinimized = true, onToggleMinimize }: ChatInterfaceProps) {
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
  const [brickLinkUrl, setBrickLinkUrl] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

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
            onClick={onToggleMinimize}
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
                    className={`max-w-[80%] rounded-lg text-xs ${
                      message.role === 'user'
                        ? colors.userBg + ' text-white p-3'
                        : (message.items && message.items.length > 0) || (message.orders && message.orders.length > 0)
                        ? 'text-gray-300' // No background for messages with inventory items or orders
                        : 'bg-gray-800/80 text-gray-300 border border-purple-500/20 p-3'
                    }`}
                  >
                    {message.role === 'user' ? (
                      message.content
                    ) : (
                      <MessageContent
                        content={message.content}
                        items={message.items}
                        orders={message.orders}
                        bricklinkSearchSuggestion={message.bricklinkSearchSuggestion}
                        onItemClick={onItemClick}
                        onBrickLinkClick={setBrickLinkUrl}
                        onBrickLinkSearch={handleBrickLinkSearch}
                      />
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>
          
          <div className={`border-t-2 ${colors.border} bg-gray-900/50 backdrop-blur-sm`}>
            <div className="flex gap-2 p-3">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                onFocus={() => setIsInputFocused(true)}
                onBlur={() => setIsInputFocused(false)}
                placeholder="Ask E.L.F.I.E. for help..."
                className="text-xs bg-gray-800/80 border-purple-500/30 focus-visible:ring-purple-500/50"
                data-testid="input-chat"
              />
              <Button 
                size="icon" 
                onClick={() => handleSend()} 
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

      {/* BrickLink iframe dialog */}
      <Dialog open={!!brickLinkUrl} onOpenChange={() => setBrickLinkUrl(null)}>
        <DialogContent className="max-w-4xl h-[80vh] p-0" aria-describedby="bricklink-description">
          <DialogHeader className="p-4 border-b">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-base flex items-center gap-2">
                <ExternalLink className="h-4 w-4" />
                BrickLink
              </DialogTitle>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setBrickLinkUrl(null)}
                className="h-8 w-8"
                data-testid="button-close-bricklink"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <p id="bricklink-description" className="sr-only">
              BrickLink catalog page displaying part information
            </p>
          </DialogHeader>
          {brickLinkUrl && (
            <iframe
              src={brickLinkUrl}
              className="w-full h-full"
              title="BrickLink"
              sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
              data-testid="iframe-bricklink"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
