import { useState } from "react";
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
}

export default function ChatInterface({ dashboardContext }: ChatInterfaceProps) {
  // TODO: remove mock functionality - replace with real OpenRouter integration
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: `Hello! I'm E.L.F.I.E., your ${dashboardContext} operations assistant. How can I help you optimize your LEGO business today?`
    }
  ]);
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (!input.trim()) return;
    
    const userMessage: ChatMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    
    // Mock response
    setTimeout(() => {
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: `I understand you're asking about "${input}". This is a demo response. In the full version, I'll provide detailed ${dashboardContext} insights and recommendations based on your data.`
      };
      setMessages(prev => [...prev, assistantMessage]);
    }, 500);
    
    setInput('');
  };

  return (
    <div className="flex flex-col h-full border-t border-gray-800 bg-gradient-to-br from-gray-900/30 to-transparent">
      <div className="flex items-center gap-2 p-3 border-b border-gray-800">
        <Bot className="h-4 w-4 text-lego-blue" />
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
                    ? 'bg-lego-blue text-white'
                    : 'bg-gray-800 text-gray-300'
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      
      <div className="p-3 border-t border-gray-800">
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Ask E.L.F.I.E. for help..."
            className="text-xs"
            data-testid="input-chat"
          />
          <Button size="icon" onClick={handleSend} data-testid="button-send">
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
