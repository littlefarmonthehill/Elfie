/**
 * AI Agent Loop with Function Calling
 * Handles the conversation flow with tool execution
 */

import { AI_TOOLS, executeToolCall } from './ai-tools';

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
}

interface AgentLoopOptions {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: Message[];
  maxIterations?: number;
}

/**
 * Run the AI agent loop with function calling support
 * Returns the final assistant message after all tool calls are resolved
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<string> {
  const { apiKey, model, systemPrompt, messages, maxIterations = 5 } = options;
  
  let conversationMessages: Message[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];
  
  let iterations = 0;
  
  while (iterations < maxIterations) {
    iterations++;
    console.log(`🤖 Agent loop iteration ${iterations}/${maxIterations}`);
    
    // Call OpenRouter with tools
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://planetbrick.replit.app',
        'X-Title': 'PlanetBrick E.L.F.I.E.',
      },
      body: JSON.stringify({
        model,
        messages: conversationMessages,
        tools: AI_TOOLS,
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 800,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.statusText} - ${errorText}`);
    }
    
    const data = await response.json();
    const assistantMessage = data.choices[0].message;
    
    // Add assistant's response to conversation
    conversationMessages.push(assistantMessage);
    
    // Check if assistant wants to call any tools
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      console.log(`🔧 Assistant wants to call ${assistantMessage.tool_calls.length} tool(s)`);
      
      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name;
        const toolParams = JSON.parse(toolCall.function.arguments);
        
        console.log(`📞 Calling tool: ${toolName}`, toolParams);
        
        // Execute the tool
        const toolResult = await executeToolCall(toolName, toolParams);
        
        console.log(`✅ Tool result:`, toolResult);
        
        // Add tool result to conversation
        conversationMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolName,
          content: JSON.stringify(toolResult),
        });
      }
      
      // Continue loop to let assistant process tool results
      continue;
    }
    
    // No tool calls - we have the final answer
    const finalContent = assistantMessage.content || '';
    console.log(`✅ Agent loop complete after ${iterations} iteration(s)`);
    return finalContent;
  }
  
  // Max iterations reached
  console.warn(`⚠️ Agent loop reached max iterations (${maxIterations})`);
  return conversationMessages[conversationMessages.length - 1].content || 'I apologize, but I encountered an issue processing your request.';
}
