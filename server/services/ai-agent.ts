/**
 * AI Agent Loop with Function Calling
 * Powered by Anthropic Claude via Replit AI Integrations
 */

import Anthropic from '@anthropic-ai/sdk';
import { AI_TOOLS, executeToolCall } from './ai-tools';

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

interface Message {
  role: 'user' | 'assistant';
  content: string | Anthropic.MessageParam['content'];
}

interface AgentLoopOptions {
  apiKey?: string;
  model?: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string; name?: string }>;
  maxIterations?: number;
}

interface AgentLoopResult {
  message: string;
  bricklinkItem?: any;
  ordersFromTool?: any[];
  forumDiscussionsFromTool?: any[];
}

/** Convert OpenAI-style tool definitions to Anthropic tool format */
function toAnthropicTools(openAiTools: typeof AI_TOOLS): Anthropic.Tool[] {
  return openAiTools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as Anthropic.Tool['input_schema'],
  }));
}

/** Convert mixed OpenAI-style message history to Anthropic messages format */
function toAnthropicMessages(
  rawMessages: AgentLoopOptions['messages']
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];

  for (const msg of rawMessages) {
    if (msg.role === 'system') continue; // handled separately as system param
    if (msg.role === 'user' || msg.role === 'assistant') {
      result.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content || '',
      });
    }
    // tool / function messages are dropped — they'll be rebuilt during agent loop
  }

  return result;
}

/**
 * Run the AI agent loop with tool calling support
 * Returns the final assistant message and any BrickLink catalog items found
 */
export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const { systemPrompt, messages, maxIterations = 5 } = options;

  // Build Anthropic message history from prior conversation
  const conversationMessages: Anthropic.MessageParam[] = toAnthropicMessages(messages);

  const tools = toAnthropicTools(AI_TOOLS);

  let iterations = 0;
  let bricklinkCatalogItem: any = null;
  let ordersFromTool: any[] = [];
  let forumDiscussionsFromTool: any[] = [];

  while (iterations < maxIterations) {
    iterations++;
    const iterStart = Date.now();
    console.log(`🤖 Agent loop iteration ${iterations}/${maxIterations}`);

    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages: conversationMessages,
        tools,
        tool_choice: { type: 'auto' },
      });
      console.log(`⏱️ Anthropic API call took ${Date.now() - iterStart}ms (iteration ${iterations})`);
    } catch (error: any) {
      if (error.message?.includes('timeout')) {
        throw new Error('Anthropic API request timed out');
      }
      throw new Error(`Anthropic API request failed: ${error.message}`);
    }

    // Add assistant response to conversation history
    conversationMessages.push({ role: 'assistant', content: response.content });

    // Check stop reason
    if (response.stop_reason === 'end_turn') {
      // No tool calls — extract text and return
      const textBlock = response.content.find((b) => b.type === 'text');
      const finalContent = textBlock && textBlock.type === 'text' ? textBlock.text : '';
      console.log(`✅ Agent loop complete after ${iterations} iteration(s)`);
      return {
        message: finalContent,
        bricklinkItem: bricklinkCatalogItem,
        ordersFromTool: ordersFromTool.length > 0 ? ordersFromTool : undefined,
        forumDiscussionsFromTool: forumDiscussionsFromTool.length > 0 ? forumDiscussionsFromTool : undefined,
      };
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
      );

      console.log(`🔧 Assistant wants to call ${toolUseBlocks.length} tool(s)`);

      // Execute each tool and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolCall of toolUseBlocks) {
        const toolName = toolCall.name;
        const toolParams = toolCall.input as any;

        console.log(`📞 Calling tool: ${toolName}`, toolParams);
        const toolStart = Date.now();

        let toolResult: any;
        try {
          toolResult = await executeToolCall(toolName, toolParams);
        } catch (error) {
          console.error(`❌ Tool execution error for ${toolName}:`, error);
          toolResult = {
            success: false,
            message: `Tool execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          };
        }

        console.log(`⏱️ Tool ${toolName} took ${Date.now() - toolStart}ms`);

        // Track BrickLink catalog items for frontend display
        if (toolName === 'search_bricklink_catalog' && toolResult.success && toolResult.data) {
          bricklinkCatalogItem = toolResult.data;
        }

        // Track orders for frontend display
        if (toolName === 'search_orders_by_item' && toolResult.success && toolResult.data?.length > 0) {
          const orderSummaries = toolResult.data.reduce((acc: any[], orderDetail: any) => {
            const existing = acc.find((o) => o.id === orderDetail.orderId);
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

        // Track forum discussions for frontend display
        if (toolName === 'search_forum_discussions' && toolResult.success && toolResult.data?.length > 0) {
          forumDiscussionsFromTool.push(...toolResult.data);
          console.log(`💬 Found ${toolResult.data.length} forum discussion(s)`);
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }

      // Add tool results as a user turn (Anthropic's required format)
      conversationMessages.push({ role: 'user', content: toolResults });

      // Continue loop to let assistant process results
      continue;
    }

    // Unexpected stop reason — return what we have
    console.warn(`⚠️ Unexpected stop_reason: ${response.stop_reason}`);
    const textBlock = response.content.find((b) => b.type === 'text');
    return {
      message: textBlock && textBlock.type === 'text' ? textBlock.text : '',
      bricklinkItem: bricklinkCatalogItem,
      ordersFromTool: ordersFromTool.length > 0 ? ordersFromTool : undefined,
      forumDiscussionsFromTool: forumDiscussionsFromTool.length > 0 ? forumDiscussionsFromTool : undefined,
    };
  }

  // Max iterations reached
  console.warn(`⚠️ Agent loop reached max iterations (${maxIterations})`);
  const lastAssistant = [...conversationMessages].reverse().find((m) => m.role === 'assistant');
  let lastText = '';
  if (lastAssistant) {
    const content = lastAssistant.content;
    if (typeof content === 'string') {
      lastText = content;
    } else if (Array.isArray(content)) {
      const tb = content.find((b: any) => b.type === 'text');
      if (tb && (tb as any).type === 'text') lastText = (tb as any).text;
    }
  }
  return {
    message: lastText || 'I apologize, but I encountered an issue processing your request.',
    bricklinkItem: bricklinkCatalogItem,
    ordersFromTool: ordersFromTool.length > 0 ? ordersFromTool : undefined,
    forumDiscussionsFromTool: forumDiscussionsFromTool.length > 0 ? forumDiscussionsFromTool : undefined,
  };
}
