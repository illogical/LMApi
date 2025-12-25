# Ollama Orchestration API Specification

## 1. Introduction
This document outlines the software specification for a new TypeScript API designed to orchestrate LLM prompts across multiple Ollama servers on a local network. The system enables parallel prompting, prioritized server utilization, and centralized logging and metrics.

## 2. Core Features

### 2.1 Server Pool Management
- **Configuration**: Servers are defined in a JSON configuration file (`servers.json`).
- **Priority**: Servers are prioritized by order in the configuration (Index 0 = Highest Priority).
- **Discovery**: The system dynamically checks and caches available models for each server.

### 2.2 Intelligent Queue System
- **Mechanism**: A prioritized, managed round-robin queue.
- **Logic**:
  - Requests are queued if no suitable server is available.
  - Dispatcher selects the next available server that hosts the required model.
  - Highest priority servers are preferred when multiple are available.
- **Queue Item Schema**:
  - `id`: Unique identifier.
  - `prompt`: The text prompt.
  - `serverName`: Specific server to target, or "Any".
  - `modelName`: Model to use.
  - `timestamp`: Creation time.

### 2.3 Response Handling
- **PromptResponse Schema**:
  - `response`: The generated text or embedding.
  - `durationMs`: Execution time (server response latency).
  - `serverName`: The server that handled the request.
  - `modelName`: Validated model name used.

### 2.4 Availability & Caching
- **Model Cache**: Caches `api/tags` results for each server to minimize latency.
- **Health Checks**: Short timeouts used to determine server availability.
- **Refresh**: Cache is refreshed on `api/tags` calls or periodic intervals.

## 3. Data Persistence & Logging

### 3.1 SQLite Database
- **Purpose**: Track metrics, history, and performance.
- **Schema**: `PromptHistory`
  - `ID`: Primary Key.
  - `ServerName`: Text.
  - `ModelName`: Text.
  - `Prompt`: Text.
  - `ResponseDuration`: Integer (ms).
  - `EstimatedTokens`: Integer (optional).
  - `Temperature`: Float.
  - `CreatedAt`: Datetime.

### 3.2 Logging Service
- **Format**: File-based logging.
- **Rotation**: Daily log files (e.g., `logs/2025-12-25.log`).
- **Levels**: Standard levels (Trace, Debug, Info, Error).
- **Content**:
  - Trace all method calls.
  - Log request/response payloads.

## 4. API Endpoints

### 4.1 Server Management
- `GET /servers`: List all servers (Name, BaseURL, Status).
- `GET /servers/available`: List only available servers with their models.
- `GET /servers/:name/status`: Get status of a specific server.

### 4.2 Model Discovery
- `GET /servers/:name/models`: Return available models for a server (uses cache/refresh).
- `GET /models/:model/servers`: Return list of servers supporting a specific model.

### 4.3 Prompting
- `POST /generate/any`
  - **Body**: `{ prompt, model, ...params }`
  - **Behavior**: Queues to next available, highest-priority server with the model.
- `POST /generate/server`
  - **Body**: `{ prompt, serverName, model, ...params }`
  - **Behavior**: Targets specific server. Errors if model unavailable.
- `POST /generate/batch`
  - **Body**: `{ prompt, models: ["modelA", "modelB"], ...params }`
  - **Behavior**: Prompts all available servers capable of running the requested models in parallel. Returns list of `PromptResponse`.
- `POST /embed`
  - **Body**: `{ text, model, ...params }`
  - **Behavior**: Returns `EmbeddingResponse` (same metadata as PromptResponse).

## 5. Technology Stack
- **Language**: TypeScript
- **Runtime**: Node.js
- **Database**: SQLite (via `sqlite3` or similar)
- **Validation**: Zod (recommended)

## 6. Future Roadmap
- Frontend Dashboard for server status and metrics.
- Comparative performance analysis (Average speed per model/server).
