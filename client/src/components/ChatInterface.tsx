import { useState, useEffect, useRef } from "react";
import { Send, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatInterfaceProps {
  dashboardContext: string;
  themeColor: 'red' | 'blue' | 'yellow' | 'green' | 'orange';
  prompts: string[];
  onPromptAction?: (prompt: string) => void;
}

export default function ChatInterface({ dashboardContext, themeColor, prompts, onPromptAction }: ChatInterfaceProps) {
  const colorClasses = {
    red: {
      gradient: 'from-lego-red/10',
      glow: 'shadow-[0_0_20px_rgba(239,68,68,0.15)]',
      border: 'border-lego-red/20',
      icon: 'text-lego-red',
      userBg: 'bg-lego-red',
      button: 'bg-lego-red hover:bg-lego-red/90',
      promptBg: 'bg-lego-red/20 hover:bg-lego-red/30 text-lego-red',
    },
    blue: {
      gradient: 'from-lego-blue/10',
      glow: 'shadow-[0_0_20px_rgba(59,130,246,0.15)]',
      border: 'border-lego-blue/20',
      icon: 'text-lego-blue',
      userBg: 'bg-lego-blue',
      button: 'bg-lego-blue hover:bg-lego-blue/90',
      promptBg: 'bg-lego-blue/20 hover:bg-lego-blue/30 text-lego-blue',
    },
    yellow: {
      gradient: 'from-lego-yellow/10',
      glow: 'shadow-[0_0_20px_rgba(234,179,8,0.15)]',
      border: 'border-lego-yellow/20',
      icon: 'text-lego-yellow',
      userBg: 'bg-lego-yellow text-black',
      button: 'bg-lego-yellow text-black hover:bg-lego-yellow/90',
      promptBg: 'bg-lego-yellow/20 hover:bg-lego-yellow/30 text-lego-yellow',
    },
    green: {
      gradient: 'from-lego-green/10',
      glow: 'shadow-[0_0_20px_rgba(34,197,94,0.15)]',
      border: 'border-lego-green/20',
      icon: 'text-lego-green',
      userBg: 'bg-lego-green',
      button: 'bg-lego-green hover:bg-lego-green/90',
      promptBg: 'bg-lego-green/20 hover:bg-lego-green/30 text-lego-green',
    },
    orange: {
      gradient: 'from-lego-orange/10',
      glow: 'shadow-[0_0_20px_rgba(251,146,60,0.15)]',
      border: 'border-lego-orange/20',
      icon: 'text-lego-orange',
      userBg: 'bg-lego-orange',
      button: 'bg-lego-orange hover:bg-lego-orange/90',
      promptBg: 'bg-lego-orange/20 hover:bg-lego-orange/30 text-lego-orange',
    },
  };

  const colors = colorClasses[themeColor];
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
    
    // Mock response
    setTimeout(() => {
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: `I understand you're asking about "${textToSend}". This is a demo response. In the full version, I'll provide detailed ${dashboardContext} insights and recommendations based on your data.`
      };
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
    <div className={`flex flex-col h-full border-t ${colors.border} bg-gradient-to-br ${colors.gradient} to-transparent ${colors.glow}`}>
      <div className={`flex items-center gap-2 p-3 border-b ${colors.border}`}>
        <Bot className={`h-4 w-4 ${colors.icon}`} />
        <span className="text-xs font-semibold text-gray-300">E.L.F.I.E.</span>
        <span className="text-xs text-gray-500">- {dashboardContext} Assistant</span>
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
                    : 'bg-gray-800 text-gray-300'
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>
      
      <div className={`border-t-2 ${colors.border}`}>
        {prompts.length > 0 && (
          <div className="flex gap-2 flex-wrap p-3 pb-3 border-b border-gray-800">
            {prompts.map((prompt) => (
              <button
                key={prompt}
                onClick={() => handlePromptClick(prompt)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${colors.promptBg}`}
                data-testid={`prompt-${prompt.toLowerCase().replace(/\s/g, '-')}`}
              >
                {prompt}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2 p-3">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask E.L.F.I.E. for help..."
            className="text-xs"
            data-testid="input-chat"
          />
          <Button size="icon" onClick={() => handleSend()} className={colors.button} data-testid="button-send">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
