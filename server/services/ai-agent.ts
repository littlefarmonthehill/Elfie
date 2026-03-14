/**
 * AI Agent Loop with Function Calling
 * Powered by OpenAI (platform key)
 */

import OpenAI from 'openai';
import { AI_TOOLS, executeToolCall } from './ai-tools';
import { getPlatformOpenAIKey } from '../routes';

interface AgentLoopOptions {
  apiKey?: string;
  model?: string;
  systemPrompt: string;
  messages: Array<{ role: string; content: string; tool_calls?: any[]; tool_call_id?: string; name?: string }>;
  maxIterations?: number;
  orgId?: string | null;
}

interface AgentLoopResult {
  message: string;
  bricklinkItem?: any;
  ordersFromTool?: any[];
  forumDiscussionsFromTool?: any[];
}

async function getOpenAIClient(): Promise<OpenAI> {
  const apiKey = await getPlatformOpenAIKey();
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Please add it in Platform Services settings.');
  }
  return new OpenAI({ apiKey });
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const { systemPrompt, maxIterations = 5 } = options;
  const agentModel = 'gpt-4o-mini';

  const openai = await getOpenAIClient();

  const conversationMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];

  for (const msg of options.messages) {
    if (msg.role === 'system') continue;
    if (msg.role === 'user' || msg.role === 'assistant') {
      conversationMessages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content || '',
      });
    }
  }

  let iterations = 0;
  let bricklinkCatalogItem: any = null;
  let ordersFromTool: any[] = [];
  let forumDiscussionsFromTool: any[] = [];

  while (iterations < maxIterations) {
    iterations++;
    const iterStart = Date.now();
    console.log(`🤖 Agent loop iteration ${iterations}/${maxIterations}`);

    let response: OpenAI.Chat.ChatCompletion;
    try {
      response = await openai.chat.completions.create({
        model: agentModel,
        max_tokens: 4096,
        messages: conversationMessages,
        tools: AI_TOOLS.map(t => ({ type: 'function' as const, function: t.function })),
        tool_choice: 'auto',
        parallel_tool_calls: true,
      });
      console.log(`⏱️ OpenAI API call took ${Date.now() - iterStart}ms (iteration ${iterations})`);
      if (response.usage) {
        const { trackUsage } = await import('./ai-usage-tracker');
        trackUsage({
          service: 'openai',
          model: agentModel,
          operation: 'elfie-agent',
          inputTokens: response.usage.prompt_tokens || 0,
          outputTokens: response.usage.completion_tokens || 0,
          totalTokens: response.usage.total_tokens || 0,
          orgId: null,
        });
      }
    } catch (error: any) {
      if (error.message?.includes('timeout')) {
        throw new Error('OpenAI API request timed out');
      }
      throw new Error(`OpenAI API request failed: ${error.message}`);
    }

    const choice = response.choices[0];
    if (!choice) {
      throw new Error('No response from OpenAI');
    }

    const assistantMessage = choice.message;
    conversationMessages.push(assistantMessage);

    if (choice.finish_reason === 'stop' || !assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      console.log(`✅ Agent loop complete after ${iterations} iteration(s)`);
      return {
        message: assistantMessage.content || '',
        bricklinkItem: bricklinkCatalogItem,
        ordersFromTool: ordersFromTool.length > 0 ? ordersFromTool : undefined,
        forumDiscussionsFromTool: forumDiscussionsFromTool.length > 0 ? forumDiscussionsFromTool : undefined,
      };
    }

    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      console.log(`🔧 Assistant wants to call ${assistantMessage.tool_calls.length} tool(s) in parallel`);

      const toolPromises = assistantMessage.tool_calls.map(async (toolCall) => {
        const toolName = toolCall.function.name;
        let toolParams: any;
        try {
          toolParams = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          toolParams = {};
        }

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

        return { toolCall, toolName, toolResult };
      });

      const toolResults = await Promise.all(toolPromises);

      for (const { toolCall, toolName, toolResult } of toolResults) {
        if (toolName === 'search_bricklink_catalog' && toolResult.success && toolResult.data) {
          bricklinkCatalogItem = toolResult.data;
        }

        if (toolName === 'search_orders_by_item' && toolResult.success && toolResult.data?.length > 0) {
          const orderSummaries = toolResult.data.reduce((acc: any[], orderDetail: any) => {
            const existing = acc.find((o: any) => o.id === orderDetail.orderId);
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

        if (toolName === 'search_forum_discussions' && toolResult.success && toolResult.data?.length > 0) {
          forumDiscussionsFromTool.push(...toolResult.data);
          console.log(`💬 Found ${toolResult.data.length} forum discussion(s)`);
        }

        conversationMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(toolResult),
        });
      }

      continue;
    }

    console.warn(`⚠️ Unexpected finish_reason: ${choice.finish_reason}`);
    return {
      message: assistantMessage.content || '',
      bricklinkItem: bricklinkCatalogItem,
      ordersFromTool: ordersFromTool.length > 0 ? ordersFromTool : undefined,
      forumDiscussionsFromTool: forumDiscussionsFromTool.length > 0 ? forumDiscussionsFromTool : undefined,
    };
  }

  console.warn(`⚠️ Agent loop reached max iterations (${maxIterations})`);
  const lastAssistant = [...conversationMessages].reverse().find((m) => m.role === 'assistant');
  return {
    message: (lastAssistant as any)?.content || 'I apologize, but I encountered an issue processing your request.',
    bricklinkItem: bricklinkCatalogItem,
    ordersFromTool: ordersFromTool.length > 0 ? ordersFromTool : undefined,
    forumDiscussionsFromTool: forumDiscussionsFromTool.length > 0 ? forumDiscussionsFromTool : undefined,
  };
}
