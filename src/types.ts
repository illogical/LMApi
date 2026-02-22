export interface PromptParams {
    temperature?: number;
    [key: string]: any;
}

export interface PromptRequest {
    prompt: string;
    model: string;
    serverName?: string; // "any" or specific
    params?: PromptParams;
    groupId?: string;
    maxParallelPerServer?: number; // Optional override for routing logic (useful for testing and fine-grained control)
}

export interface PromptResponse {
    response: string | Array<number>;
    durationMs: number;
    serverName: string;
    model: string;
    created_at?: string;
    thinking?: string;
    loadDuration?: number;
    evalDuration?: number;
    totalDuration?: number;
    inputTokens?: number;
    outputTokens?: number;
}

export interface QueueItem {
    id: string;
    request: PromptRequest;
    createdAt: number;
    resolve: (response: PromptResponse) => void;
    reject: (error: Error) => void;
}

// Chat Completion Types
export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | object[] | null;
    name?: string;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ChatCompletionRequest {
    model: string;
    messages: ChatMessage[];
    tools?: any[];
    tool_choice?: any;
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    stop?: string | string[];
    stream?: boolean;
    n?: number;
    // LMAPI extensions
    serverName?: string;
    models?: string[];
    groupId?: string;
    maxParallelPerServer?: number;
    provider?: string;
}

export interface ChatCompletionResponse {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: ChatCompletionChoice[];
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
    };
    // LMAPI extensions
    lmapi?: {
        server_name: string;
        duration_ms: number;
        ttft_ms?: number;   // Time to first token (streaming only, client-measured)
        group_id?: string;
    };
}

export interface ChatCompletionChoice {
    index: number;
    message: ChatMessage;
    finish_reason: string | null;
}

export interface ChatQueueItem {
    id: string;
    request: ChatCompletionRequest;
    createdAt: number;
    resolve: (response: ChatCompletionResponse) => void;
    reject: (error: Error) => void;
}
