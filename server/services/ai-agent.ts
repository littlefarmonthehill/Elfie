/**
 * AI Agent Loop with Function Calling
 * Handles the conversation flow with tool execution
 */

import OpenAI from 'openai';
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
  forumDiscussionsFromTool?: any[];
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
  let forumDiscussionsFromTool: any[] = [];
  
  while (iterations < maxIterations) {
    iterations++;
    console.log(`🤖 Agent loop iteration ${iterations}/${maxIterations}`);
    
    // Call OpenAI with tools (with timeout)
    const openai = new OpenAI({ apiKey });
    
    let completion;
    try {
      completion = await openai.chat.completions.create({
        model,
        messages: conversationMessages as any,
        tools: AI_TOOLS as any,
        tool_choice: 'auto',
        temperature: 0.7,
        max_tokens: 800,
      }, {
        timeout: 30000, // 30 second timeout
      });
    } catch (error: any) {
      if (error.message?.includes('timeout')) {
        throw new Error('OpenAI API request timed out after 30 seconds');
      }
      throw new Error(`OpenAI API request failed: ${error.message}`);
    }
    
    // Validate response structure
    if (!completion.choices || !completion.choices[0] || !completion.choices[0].message) {
      throw new Error('Invalid response from OpenAI API: missing message');
    }
    
    const assistantMessage = completion.choices[0].message;
    
    // Add assistant's response to conversation (convert to our Message type)
    conversationMessages.push({
      role: assistantMessage.role as 'assistant',
      content: assistantMessage.content || '',
      tool_calls: assistantMessage.tool_calls,
    });
    
    // Check if assistant wants to call any tools
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      console.log(`🔧 Assistant wants to call ${assistantMessage.tool_calls.length} tool(s)`);
      
      // Execute each tool call
      for (const toolCall of assistantMessage.tool_calls) {
        // Type guard for function-based tool calls
        if (toolCall.type !== 'function' || !toolCall.function) {
          console.warn('⚠️ Skipping non-function tool call:', toolCall);
          continue;
        }
        
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
        
        // Track forum discussions from search_forum_discussions for frontend display
        if (toolName === 'search_forum_discussions' && toolResult.success && toolResult.data && toolResult.data.length > 0) {
          forumDiscussionsFromTool.push(...toolResult.data);
          console.log(`💬 Found ${toolResult.data.length} forum discussion(s) from search_forum_discussions tool`);
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
      forumDiscussionsFromTool: forumDiscussionsFromTool.length > 0 ? forumDiscussionsFromTool : undefined,
    };
  }
  
  // Max iterations reached
  console.warn(`⚠️ Agent loop reached max iterations (${maxIterations})`);
  return {
    message: conversationMessages[conversationMessages.length - 1].content || 'I apologize, but I encountered an issue processing your request.',
    bricklinkItem: bricklinkCatalogItem,
    ordersFromTool: ordersFromTool.length > 0 ? ordersFromTool : undefined,
    forumDiscussionsFromTool: forumDiscussionsFromTool.length > 0 ? forumDiscussionsFromTool : undefined,
  };
}
