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
