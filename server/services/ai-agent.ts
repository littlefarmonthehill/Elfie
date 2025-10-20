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

interface AgentLoopResult {
  message: string;
  bricklinkItem?: any;
  ordersFromTool?: any[];
}

/**
 * Run the AI agent loop with function calling support
 * Returns the final assistant message and any BrickLink catalog items found
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const { apiKey, model, systemPrompt, messages, maxIterations = 5 } = options;
  
  let conversationMessages: Message[] = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];
  
  let iterations = 0;
  let bricklinkCatalogItem: any = null;
  let ordersFromTool: any[] = [];
  
  while (iterations < maxIterations) {
    iterations++;
    console.log(`🤖 Agent loop iteration ${iterations}/${maxIterations}`);
    
    // Call OpenRouter with tools (with timeout)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    let response;
    try {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
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
        signal: controller.signal,
      });
    } catch (error: any) {
      clearTimeout(timeout);
      if (error.name === 'AbortError') {
        throw new Error('OpenRouter API request timed out after 30 seconds');
      }
      throw new Error(`OpenRouter API request failed: ${error.message}`);
    }
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error: ${response.statusText} - ${errorText}`);
    }
    
    const data = await response.json();
    
    // Validate response structure
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response from OpenRouter API: missing message');
    }
    
    const assistantMessage = data.choices[0].message;
    
    // Add assistant's response to conversation
    conversationMessages.push(assistantMessage);
    
    // Check if assistant wants to call any tools
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      console.log(`🔧 Assistant wants to call ${assistantMessage.tool_calls.length} tool(s)`);
      
      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        const toolName = toolCall.function.name;
        
        // Defensive JSON parsing
        let toolParams;
        try {
          toolParams = JSON.parse(toolCall.function.arguments);
        } catch (error) {
          console.error(`❌ Failed to parse tool arguments for ${toolName}:`, error);
          // Add error result to conversation so model can retry
          conversationMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolName,
            content: JSON.stringify({
              success: false,
              message: `Invalid tool arguments: ${error instanceof Error ? error.message : 'JSON parse error'}`,
            }),
          });
          continue;
        }
        
        console.log(`📞 Calling tool: ${toolName}`, toolParams);
        
        // Execute the tool with error handling
        let toolResult;
        try {
          toolResult = await executeToolCall(toolName, toolParams);
        } catch (error) {
          console.error(`❌ Tool execution error for ${toolName}:`, error);
          toolResult = {
            success: false,
            message: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
        }
        
        console.log(`✅ Tool result:`, toolResult);
        
        // Track BrickLink catalog items for frontend display
        if (toolName === 'search_bricklink_catalog' && toolResult.success && toolResult.data) {
          bricklinkCatalogItem = toolResult.data;
          console.log('📦 BrickLink catalog item found:', bricklinkCatalogItem);
        }
        
        // Track orders from search_orders_by_item for frontend display as clickable items
        if (toolName === 'search_orders_by_item' && toolResult.success && toolResult.data && toolResult.data.length > 0) {
          // Transform order details into order summary format for OrderGroup component
          const orderSummaries = toolResult.data.reduce((acc: any[], orderDetail: any) => {
            // Check if we already have this order in the summary
            const existing = acc.find(o => o.id === orderDetail.orderId);
            if (!existing) {
              acc.push({
                id: orderDetail.orderId,
                orderNumber: orderDetail.orderNumber,
                marketplace: orderDetail.marketplace,
                orderDate: orderDetail.orderDate,
                orderTotal: orderDetail.orderTotal || '0.00',
                customerUsername: orderDetail.customerUsername,
                orderStatus: orderDetail.orderStatus || 'Unknown',
              });
            }
            return acc;
          }, []);
          
          ordersFromTool.push(...orderSummaries);
          console.log(`📦 Found ${orderSummaries.length} order(s) from search_orders_by_item tool`);
        }
        
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
    return {
      message: finalContent,
      bricklinkItem: bricklinkCatalogItem,
      ordersFromTool: ordersFromTool.length > 0 ? ordersFromTool : undefined,
    };
  }
  
  // Max iterations reached
  console.warn(`⚠️ Agent loop reached max iterations (${maxIterations})`);
  return {
    message: conversationMessages[conversationMessages.length - 1].content || 'I apologize, but I encountered an issue processing your request.',
    bricklinkItem: bricklinkCatalogItem,
    ordersFromTool: ordersFromTool.length > 0 ? ordersFromTool : undefined,
  };
}
