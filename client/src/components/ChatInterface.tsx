import { useState, useEffect, useRef } from "react";
import { Send, Bot, RefreshCcw, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  items?: Array<{
    type: 'inventory' | 'order' | 'sales' | 'marketing';
    id: string;
    label: string;
    orderNumber?: string;
    customerName?: string;
    date?: string;
    total?: number;
    isRepeatCustomer?: boolean;
  }>;
}

interface ChatInterfaceProps {
  dashboardContext: string;
  themeColor: 'red' | 'blue' | 'yellow' | 'green' | 'orange';
  prompts: string[];
  onPromptAction?: (prompt: string) => void;
  onItemClick?: (type: 'inventory' | 'order' | 'sales' | 'marketing', id: string) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

export default function ChatInterface({ dashboardContext, themeColor, prompts, onPromptAction, onItemClick, isExpanded = false, onToggleExpand }: ChatInterfaceProps) {
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
  // TODO: remove mock functionality - replace with real OpenRouter integration
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: `Hello! I'm E.L.F.I.E., your ${dashboardContext} operations assistant. How can I help you optimize your LEGO business today?`
    }
  ]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = (message?: string) => {
    const textToSend = message || input;
    if (!textToSend.trim()) return;
    
    const userMessage: ChatMessage = { role: 'user', content: textToSend };
    setMessages(prev => [...prev, userMessage]);
    
    // Mock response with clickable items
    setTimeout(() => {
      let assistantMessage: ChatMessage = {
        role: 'assistant',
        content: `I understand you're asking about "${textToSend}". This is a demo response.`
      };

      // Generate mock items based on context and query
      if (dashboardContext.toLowerCase().includes('inventory') && textToSend.toLowerCase().includes('3201')) {
        assistantMessage.content = "I found your inventory for part 3201. Here's what you have:";
        assistantMessage.items = [
          { type: 'inventory', id: '3201-black', label: 'Part 3201 - Black (45 units)' },
          { type: 'inventory', id: '3201-red', label: 'Part 3201 - Red (23 units)' },
          { type: 'inventory', id: '3201-blue', label: 'Part 3201 - Blue (12 units)' },
        ];
      } else if (dashboardContext.toLowerCase().includes('order') && (textToSend.toLowerCase().includes('open') || textToSend.toLowerCase().includes('awaiting'))) {
        assistantMessage.content = "Here are your open orders:";
        assistantMessage.items = [
          { 
            type: 'order', 
            id: 'ord-1001', 
            label: 'Order #1001',
            orderNumber: '1001',
            customerName: 'John Smith',
            date: '2024-01-20',
            total: 156.80,
            isRepeatCustomer: true
          },
          { 
            type: 'order', 
            id: 'ord-1002', 
            label: 'Order #1002',
            orderNumber: '1002',
            customerName: 'Sarah Johnson',
            date: '2024-01-21',
            total: 89.50,
            isRepeatCustomer: false
          },
          { 
            type: 'order', 
            id: 'ord-1003', 
            label: 'Order #1003',
            orderNumber: '1003',
            customerName: 'Michael Brown',
            date: '2024-01-18',
            total: 245.00,
            isRepeatCustomer: true
          },
        ];
      }

      setMessages(prev => [...prev, assistantMessage]);
    }, 500);
    
    setInput('');
  };

  const handlePromptClick = (prompt: string) => {
    if (onPromptAction) {
      onPromptAction(prompt);
    }
    handleSend(prompt);
  };

  return (
    <div className={`flex flex-col h-full border-t-4 ${colors.border} bg-gradient-to-br ${colors.gradient} to-transparent ${colors.glow}`}>
      <div className={`flex items-center justify-between gap-2 p-3 border-b-2 ${colors.border} ${colors.headerBg} backdrop-blur-sm`}>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-2 py-1 rounded-full bg-purple-500/20 border border-purple-500/30">
            <Bot className={`h-4 w-4 ${colors.icon}`} />
            <span className="text-sm font-bold text-purple-300">E.L.F.I.E.</span>
          </div>
          <span className="text-xs text-gray-400">AI Assistant</span>
        </div>
        {onToggleExpand && (
          <Button
            size="icon"
            variant="ghost"
            onClick={onToggleExpand}
            className="h-7 w-7 hover:bg-purple-500/20"
            data-testid="button-toggle-chat"
          >
            {isExpanded ? (
              <ChevronDown className={`h-4 w-4 ${colors.icon}`} />
            ) : (
              <ChevronUp className={`h-4 w-4 ${colors.icon}`} />
            )}
          </Button>
        )}
      </div>
      
      <ScrollArea className="flex-1 p-4">
        <div className="space-y-4">
          {messages.map((message, i) => (
            <div
              key={i}
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              data-testid={`message-${message.role}-${i}`}
            >
              <div
                className={`max-w-[80%] rounded-lg p-3 text-xs ${
                  message.role === 'user'
                    ? colors.userBg + ' text-white'
                    : 'bg-gray-800/80 text-gray-300 border border-purple-500/20'
                }`}
              >
                {message.content}
                {message.items && message.items.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {message.items.map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => onItemClick?.(item.type, item.id)}
                        className={`block w-full text-left px-3 py-1.5 rounded-md text-xs ${colors.promptBg} transition-colors`}
                        data-testid={`item-${item.type}-${item.id}`}
                      >
                        {item.type === 'order' && item.orderNumber ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-shrink-0 w-4">
                              {item.isRepeatCustomer && (
                                <RefreshCcw className="h-3 w-3" />
                              )}
                            </div>
                            <div className="flex-1 flex items-center justify-between gap-3">
                              <span className="font-medium">#{item.orderNumber}</span>
                              <span className="flex-1">{item.customerName}</span>
                              <span className="text-gray-400">{item.date}</span>
                              <span className="font-semibold">${item.total?.toFixed(2)}</span>
                            </div>
                          </div>
                        ) : (
                          item.label
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>
      
      <div className={`border-t-2 ${colors.border} bg-gray-900/50 backdrop-blur-sm`}>
        <div className="flex gap-2 p-3">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask E.L.F.I.E. for help..."
            className="text-xs bg-gray-800/80 border-purple-500/30 focus-visible:ring-purple-500/50"
            data-testid="input-chat"
          />
          <Button size="icon" onClick={() => handleSend()} className={colors.button} data-testid="button-send">
            <Send className="h-4 w-4" />
          </Button>
        </div>
        {prompts.length > 0 && (
          <div className="flex gap-2 flex-wrap p-3 pt-0 pb-3 border-t border-purple-500/20">
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
    </div>
  );
}
