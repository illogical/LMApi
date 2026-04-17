/**
 * @openapi
 * components:
 *   schemas:
 *     Error:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           description: Error message
 *
 *     OpenAIError:
 *       type: object
 *       properties:
 *         error:
 *           type: object
 *           properties:
 *             message:
 *               type: string
 *             type:
 *               type: string
 *               example: invalid_request_error
 *             param:
 *               type: string
 *               nullable: true
 *             code:
 *               type: string
 *               nullable: true
 *
 *     ServerStatus:
 *       type: object
 *       properties:
 *         config:
 *           type: object
 *           properties:
 *             name:
 *               type: string
 *               description: Server name identifier
 *             baseUrl:
 *               type: string
 *               description: Base URL of the Ollama server
 *             disabled:
 *               type: boolean
 *               description: Whether the server is disabled
 *         isOnline:
 *           type: boolean
 *         models:
 *           type: array
 *           items:
 *             type: string
 *           description: Available model names
 *         runningModels:
 *           type: array
 *           items:
 *             type: object
 *           description: Models currently loaded in VRAM
 *         activeRequests:
 *           type: integer
 *           description: Number of requests currently being processed
 *         lastChecked:
 *           type: string
 *           format: date-time
 *
 *     PromptRequest:
 *       type: object
 *       required: [prompt, model]
 *       properties:
 *         prompt:
 *           type: string
 *           description: The prompt text to send to the model
 *         model:
 *           type: string
 *           description: Model name (e.g., "llama3.1:8b")
 *         serverName:
 *           type: string
 *           description: Target server name, or omit for auto-routing
 *         groupId:
 *           type: string
 *           description: Optional group ID to correlate related requests
 *         params:
 *           type: object
 *           additionalProperties: true
 *           description: Additional model parameters (temperature, etc.)
 *         maxParallelPerServer:
 *           type: integer
 *           minimum: 1
 *           description: Override for max concurrent requests per server
 *
 *     BatchPromptRequest:
 *       type: object
 *       required: [prompt, models]
 *       properties:
 *         prompt:
 *           type: string
 *           description: The prompt text to send to all models
 *         models:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of model names to run in parallel
 *         params:
 *           type: object
 *           additionalProperties: true
 *           description: Additional model parameters
 *         maxParallelPerServer:
 *           type: integer
 *           minimum: 1
 *
 *     PromptResponse:
 *       type: object
 *       properties:
 *         response:
 *           oneOf:
 *             - type: string
 *             - type: array
 *               items:
 *                 type: number
 *           description: Generated text or embedding vector
 *         duration_ms:
 *           type: number
 *           description: Total request duration in milliseconds
 *         server_name:
 *           type: string
 *           description: Server that handled the request
 *         model:
 *           type: string
 *           description: Model used for generation
 *         created_at:
 *           type: string
 *           format: date-time
 *         thinking:
 *           type: string
 *           description: Model's reasoning/thinking output (if available)
 *         load_duration:
 *           type: number
 *           description: Time to load the model (nanoseconds)
 *         eval_duration:
 *           type: number
 *           description: Evaluation duration (nanoseconds)
 *         total_duration:
 *           type: number
 *           description: Total Ollama processing time (nanoseconds)
 *         prompt_eval_count:
 *           type: integer
 *           description: Number of input tokens
 *         eval_count:
 *           type: integer
 *           description: Number of output tokens
 *
 *     ChatMessage:
 *       type: object
 *       required: [role]
 *       properties:
 *         role:
 *           type: string
 *           enum: [system, user, assistant, tool]
 *         content:
 *           oneOf:
 *             - type: string
 *             - type: array
 *               items:
 *                 type: object
 *             - type: "null"
 *           description: Message content
 *         name:
 *           type: string
 *         tool_calls:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [function]
 *               function:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   arguments:
 *                     type: string
 *         tool_call_id:
 *           type: string
 *
 *     ChatCompletionRequest:
 *       type: object
 *       required: [model, messages]
 *       properties:
 *         model:
 *           type: string
 *           description: Model name
 *         messages:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ChatMessage'
 *           minItems: 1
 *         tools:
 *           type: array
 *           items:
 *             type: object
 *           description: Tool definitions for function calling
 *         tool_choice:
 *           description: Controls tool selection behavior
 *         temperature:
 *           type: number
 *           description: Sampling temperature (0-2)
 *         max_tokens:
 *           type: integer
 *           description: Maximum tokens to generate
 *         top_p:
 *           type: number
 *           description: Nucleus sampling threshold
 *         frequency_penalty:
 *           type: number
 *         presence_penalty:
 *           type: number
 *         stop:
 *           oneOf:
 *             - type: string
 *             - type: array
 *               items:
 *                 type: string
 *           description: Stop sequences
 *         stream:
 *           type: boolean
 *           default: false
 *           description: Whether to stream the response via SSE
 *         n:
 *           type: integer
 *           description: Number of completions to generate
 *         provider:
 *           type: string
 *           description: Explicit cloud provider name (e.g., "openrouter")
 *
 *     LMAPIChatCompletionRequest:
 *       allOf:
 *         - $ref: '#/components/schemas/ChatCompletionRequest'
 *         - type: object
 *           properties:
 *             serverName:
 *               type: string
 *               description: Target server name for routing
 *             models:
 *               type: array
 *               items:
 *                 type: string
 *               description: List of models (used in batch/broadcast)
 *             groupId:
 *               type: string
 *               description: Group ID to correlate related requests
 *             maxParallelPerServer:
 *               type: integer
 *               minimum: 1
 *               description: Override for max concurrent requests per server
 *             provider:
 *               type: string
 *               description: Explicit cloud provider name
 *
 *     BatchChatCompletionRequest:
 *       type: object
 *       required: [messages, models]
 *       properties:
 *         messages:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ChatMessage'
 *           minItems: 1
 *         models:
 *           type: array
 *           items:
 *             type: string
 *           description: Array of model names to run in parallel
 *         tools:
 *           type: array
 *           items:
 *             type: object
 *         tool_choice:
 *           description: Controls tool selection
 *         temperature:
 *           type: number
 *         max_tokens:
 *           type: integer
 *         top_p:
 *           type: number
 *         frequency_penalty:
 *           type: number
 *         presence_penalty:
 *           type: number
 *         stop:
 *           oneOf:
 *             - type: string
 *             - type: array
 *               items:
 *                 type: string
 *         stream:
 *           type: boolean
 *           default: false
 *         n:
 *           type: integer
 *         groupId:
 *           type: string
 *         maxParallelPerServer:
 *           type: integer
 *           minimum: 1
 *
 *     ChatCompletionResponse:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: Unique completion ID
 *         object:
 *           type: string
 *           enum: [chat.completion]
 *         created:
 *           type: integer
 *           description: Unix timestamp
 *         model:
 *           type: string
 *         choices:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               index:
 *                 type: integer
 *               message:
 *                 $ref: '#/components/schemas/ChatMessage'
 *               finish_reason:
 *                 type: string
 *                 nullable: true
 *                 enum: [stop, length, tool_calls, null]
 *         usage:
 *           type: object
 *           properties:
 *             prompt_tokens:
 *               type: integer
 *             completion_tokens:
 *               type: integer
 *             total_tokens:
 *               type: integer
 *
 *     LMAPIChatCompletionResponse:
 *       allOf:
 *         - $ref: '#/components/schemas/ChatCompletionResponse'
 *         - type: object
 *           properties:
 *             lmapi:
 *               type: object
 *               description: LMAPI-specific metadata
 *               properties:
 *                 server_name:
 *                   type: string
 *                   description: Server that handled the request
 *                 duration_ms:
 *                   type: number
 *                   description: Total request duration in milliseconds
 *                 ttft_ms:
 *                   type: number
 *                   description: Time to first token (streaming only)
 *                 group_id:
 *                   type: string
 *                   description: Group ID for correlated requests
 *
 *     ActiveRequestState:
 *       type: object
 *       properties:
 *         requestId:
 *           type: string
 *           format: uuid
 *         groupId:
 *           type: string
 *           nullable: true
 *         requestType:
 *           type: string
 *           enum: [generate, chat, embed, agent]
 *         serverName:
 *           type: string
 *           nullable: true
 *         modelName:
 *           type: string
 *         phase:
 *           type: string
 *           enum: [queued, dispatching, evaluating, streaming, completed, failed, cancelled]
 *         startedAt:
 *           type: string
 *           format: date-time
 *         queuedAt:
 *           type: string
 *           format: date-time
 *         dispatchedAt:
 *           type: string
 *           format: date-time
 *         lastActivityAt:
 *           type: string
 *           format: date-time
 *         elapsedMs:
 *           type: number
 *           description: Elapsed time in milliseconds (computed on read)
 *         promptPreview:
 *           type: string
 *           description: Truncated preview of the prompt
 *         retryCount:
 *           type: integer
 *         error:
 *           type: string
 *           nullable: true
 *
 *     GroupStatus:
 *       type: object
 *       properties:
 *         groupId:
 *           type: string
 *         total:
 *           type: integer
 *         queued:
 *           type: integer
 *         running:
 *           type: integer
 *         completed:
 *           type: integer
 *         failed:
 *           type: integer
 *         byModel:
 *           type: object
 *           additionalProperties:
 *             type: integer
 *         byServer:
 *           type: object
 *           additionalProperties:
 *             type: integer
 *         startedAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *
 *     EvaluationRequest:
 *       type: object
 *       required: [models]
 *       properties:
 *         prompt:
 *           type: string
 *           description: Prompt text (at least one of prompt or filePath required)
 *         filePath:
 *           type: string
 *           description: Absolute path to a file containing the prompt
 *         models:
 *           type: array
 *           items:
 *             type: string
 *           minItems: 1
 *           description: Models to evaluate
 *         temperature:
 *           type: number
 *           minimum: 0
 *           maximum: 2
 *         max_tokens:
 *           type: integer
 *           minimum: 1
 *         generateReport:
 *           type: boolean
 *           default: true
 *           description: Whether to generate a markdown comparison report
 *
 *     EvaluationResult:
 *       type: object
 *       properties:
 *         model:
 *           type: string
 *         server_name:
 *           type: string
 *         duration_ms:
 *           type: number
 *         input_tokens:
 *           type: integer
 *         output_tokens:
 *           type: integer
 *         tokens_per_second:
 *           type: number
 *         load_duration_ms:
 *           type: number
 *         eval_duration_ms:
 *           type: number
 *         finish_reason:
 *           type: string
 *         response_text:
 *           type: string
 *         thinking:
 *           type: string
 *         tool_calls:
 *           type: array
 *           items:
 *             type: object
 *         error:
 *           type: string
 */
