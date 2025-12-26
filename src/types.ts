export interface PromptParams {
    temperature?: number;
    [key: string]: any;
}

export interface PromptRequest {
    prompt: string;
    model: string;
    serverName?: string; // "any" or specific
    params?: PromptParams;
}

export interface PromptResponse {
    response: string;
    durationMs: number;
    serverName: string;
    model: string;
    created_at?: string;
}

export interface QueueItem {
    id: string;
    request: PromptRequest;
    createdAt: number;
    resolve: (response: PromptResponse) => void;
    reject: (error: Error) => void;
}
