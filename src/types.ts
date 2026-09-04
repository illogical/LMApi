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
    seed?: number;
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

// Observability & Eval types

export type RequestPhase =
  | 'queued'
  | 'dispatching'
  | 'evaluating'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ActiveRequestState {
    requestId: string;
    groupId?: string | null;
    requestType: 'generate' | 'chat' | 'embed' | 'agent';
    serverName?: string | null;
    modelName: string;
    phase: RequestPhase;
    startedAt: string;        // ISO
    queuedAt?: string;
    dispatchedAt?: string;
    lastActivityAt: string;
    elapsedMs: number;        // computed on read
    promptPreview?: string;
    retryCount: number;
    error?: string | null;
}

export interface GroupStatus {
    groupId: string;
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    byModel: Record<string, number>;
    byServer: Record<string, number>;
    startedAt: string;
    updatedAt: string;
}

export interface EvaluationRequest {
    prompt?: string;
    filePath?: string;
    models: string[];
    temperature?: number;
    max_tokens?: number;
    generateReport?: boolean;   // default true
}

export interface EvaluationResult {
    model: string;
    server_name: string;
    duration_ms: number;
    input_tokens?: number;
    output_tokens?: number;
    tokens_per_second?: number;
    load_duration_ms?: number;
    eval_duration_ms?: number;
    finish_reason: string;
    response_text: string;
    thinking?: string;
    tool_calls?: any[];
    error?: string;
}
