import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { LogService } from './LogService';
import { SocketService } from './SocketService';
import { AppPaths } from '../config/AppPaths';

export interface PromptHistoryRecord {
    id: number;
    serverName: string;
    modelName: string;
    prompt?: string;
    responseText?: string;
    /** Total request duration measured by the API client (end-to-end) */
    responseDurationMs?: number;
    /** Number of input tokens (prompt_eval_count from Ollama) */
    inputTokens?: number;
    /** Number of output tokens (eval_count from Ollama) */
    outputTokens?: number;
    /** Time spent loading the model into memory (load_duration from Ollama) */
    loadDuration?: number;
    /** Time spent evaluating prompts and generating output (prompt_eval_duration + eval_duration from Ollama) */
    evalDuration?: number;
    /** Total time on the Ollama server (total_duration from Ollama) - typically includes load_duration + eval_duration */
    totalDuration?: number;
    /** Model thinking/reasoning output (if supported by the model) */
    thinking?: string;
    /** Full messages array as JSON string (chat requests only) */
    messages?: string;
    /** Raw tool_calls JSON array from the response */
    toolCalls?: string;
    temperature?: number;
    createdAt: string;
    responseAt?: string;
    isError: boolean;
    groupId?: string;
    requestType?: string; // 'generate', 'chat', 'embed'
}

export interface PromptHistoryQuery {
    limit: number;
    offset: number;
    sort: 'createdAt' | 'responseDurationMs' | 'serverName' | 'modelName' | 'totalDuration' | 'evalDuration';
    direction: 'ASC' | 'DESC';
    modelName?: string;
    serverName?: string;
    groupId?: string;
    requestType?: string;
    isError?: boolean;
    createdAfter?: string;
    createdBefore?: string;
    durationGt?: number;
    durationLt?: number;
}

export class DbService {
    private static db: Database.Database;

    static initialize() {
        const dbPath = AppPaths.getDbPath();
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');

        this.migrate();
        LogService.info('Database initialized at ' + dbPath);
    }

    private static migrate() {
        const createTableQuery = `
      CREATE TABLE IF NOT EXISTS PromptHistory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        serverName TEXT NOT NULL,
        modelName TEXT NOT NULL,
        prompt TEXT,
        responseText TEXT,
        responseDurationMs INTEGER,
        inputTokens INTEGER,
        outputTokens INTEGER,
        temperature REAL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
        this.db.exec(createTableQuery);
        
        // Add responseText column if it doesn't exist (for existing databases)
        try {
            this.db.exec('ALTER TABLE PromptHistory ADD COLUMN responseText TEXT');
            LogService.info('Added responseText column to PromptHistory table');
        } catch (err: any) {
            if (!err.message.includes('duplicate column')) {
                LogService.warn('Migration warning (responseText): ' + err.message);
            }
        }

        // Add outputTokens column if it doesn't exist (replaces estimatedOutputTokens)
        try {
            this.db.exec('ALTER TABLE PromptHistory ADD COLUMN outputTokens INTEGER');
            LogService.info('Added outputTokens column to PromptHistory table');
        } catch (err: any) {
            if (!err.message.includes('duplicate column')) {
                LogService.warn('Migration warning (outputTokens): ' + err.message);
            }
        }

        // Add responseAt column if it doesn't exist
        try {
            this.db.exec('ALTER TABLE PromptHistory ADD COLUMN responseAt DATETIME');
            LogService.info('Added responseAt column to PromptHistory table');
        } catch (err: any) {
            if (!err.message.includes('duplicate column')) {
                LogService.warn('Migration warning (responseAt): ' + err.message);
            }
        }

        // Add isError column if it doesn't exist
        try {
            this.db.exec('ALTER TABLE PromptHistory ADD COLUMN isError INTEGER DEFAULT 0');
            LogService.info('Added isError column to PromptHistory table');
        } catch (err: any) {
            if (!err.message.includes('duplicate column')) {
                LogService.warn('Migration warning (isError): ' + err.message);
            }
        }

        // Add groupId column if it doesn't exist
        try {
            this.db.exec('ALTER TABLE PromptHistory ADD COLUMN groupId TEXT');
            LogService.info('Added groupId column to PromptHistory table');
        } catch (err: any) {
            if (!err.message.includes('duplicate column')) {
                LogService.warn('Migration warning (groupId): ' + err.message);
            }
        }

        // Add inputTokens column if it doesn't exist (replaces estimatedTokens)
        try {
            this.db.exec('ALTER TABLE PromptHistory ADD COLUMN inputTokens INTEGER');
            LogService.info('Added inputTokens column to PromptHistory table');
        } catch (err: any) {
            if (!err.message.includes('duplicate column')) {
                LogService.warn('Migration warning (inputTokens): ' + err.message);
            }
        }

        // Add loadDuration column if it doesn't exist
        try {
            this.db.exec('ALTER TABLE PromptHistory ADD COLUMN loadDuration INTEGER');
            LogService.info('Added loadDuration column to PromptHistory table');
        } catch (err: any) {
            if (!err.message.includes('duplicate column')) {
                LogService.warn('Migration warning (loadDuration): ' + err.message);
            }
        }

        // Add evalDuration column if it doesn't exist (combination of prompt_eval_duration and eval_duration)
        try {
            this.db.exec('ALTER TABLE PromptHistory ADD COLUMN evalDuration INTEGER');
            LogService.info('Added evalDuration column to PromptHistory table');
        } catch (err: any) {
            if (!err.message.includes('duplicate column')) {
                LogService.warn('Migration warning (evalDuration): ' + err.message);
            }
        }

        // Add totalDuration column if it doesn't exist
        try {
            this.db.exec('ALTER TABLE PromptHistory ADD COLUMN totalDuration INTEGER');
            LogService.info('Added totalDuration column to PromptHistory table');
        } catch (err: any) {
            if (!err.message.includes('duplicate column')) {
                LogService.warn('Migration warning (totalDuration): ' + err.message);
            }
        }

        // Add thinking column if it doesn't exist
        try {
            this.db.exec('ALTER TABLE PromptHistory ADD COLUMN thinking TEXT');
            LogService.info('Added thinking column to PromptHistory table');
        } catch (err: any) {
            if (!err.message.includes('duplicate column')) {
                LogService.warn('Migration warning (thinking): ' + err.message);
            }
        }

        // Add requestType column if it doesn't exist
        try {
            this.db.exec('ALTER TABLE PromptHistory ADD COLUMN requestType TEXT DEFAULT \'generate\'');
            LogService.info('Added requestType column to PromptHistory table');
        } catch (err: any) {
            if (!err.message.includes('duplicate column')) {
                LogService.warn('Migration warning (requestType): ' + err.message);
            }
        }

        // Add messages column if it doesn't exist (full messages array JSON for chat requests)
        try {
            this.db.exec('ALTER TABLE PromptHistory ADD COLUMN messages TEXT');
            LogService.info('Added messages column to PromptHistory table');
        } catch (err: any) {
            if (!err.message.includes('duplicate column')) {
                LogService.warn('Migration warning (messages): ' + err.message);
            }
        }

        // Add toolCalls column if it doesn't exist (raw tool_calls JSON array from response)
        try {
            this.db.exec('ALTER TABLE PromptHistory ADD COLUMN toolCalls TEXT');
            LogService.info('Added toolCalls column to PromptHistory table');
        } catch (err: any) {
            if (!err.message.includes('duplicate column')) {
                LogService.warn('Migration warning (toolCalls): ' + err.message);
            }
        }

        this.db.exec('CREATE INDEX IF NOT EXISTS idx_PromptHistory_createdAt ON PromptHistory(createdAt DESC)');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_PromptHistory_modelName ON PromptHistory(modelName)');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_PromptHistory_serverName ON PromptHistory(serverName)');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_PromptHistory_prompt ON PromptHistory(prompt)');
    }

    static getDb() {
        if (!this.db) {
            this.initialize();
        }
        return this.db;
    }

    /** Cheap health signal for a hosted adapter's getStatus() — does not open a connection. */
    static isInitialized(): boolean {
        return !!this.db;
    }

    /**
     * Closes the SQLite connection. Idempotent — safe to call before
     * `initialize()` and safe to call twice.
     */
    static dispose(): void {
        if (!this.db) return;
        this.db.close();
        this.db = undefined as unknown as Database.Database;
    }

    static insertPromptHistory(entry: {
        serverName: string;
        modelName: string;
        prompt?: string;
        responseText?: string;
        responseDurationMs?: number;
        inputTokens?: number;
        outputTokens?: number;
        loadDuration?: number;
        evalDuration?: number;
        totalDuration?: number;
        thinking?: string;
        messages?: string;
        toolCalls?: string;
        temperature?: number;
        createdAt?: string;
        responseAt?: string;
        isError?: boolean;
        groupId?: string;
        requestType?: string;
    }) {
        const db = this.getDb();
        const stmt = db.prepare(`
      INSERT INTO PromptHistory (serverName, modelName, prompt, responseText, responseDurationMs, inputTokens, outputTokens, loadDuration, evalDuration, totalDuration, thinking, messages, toolCalls, temperature, createdAt, responseAt, isError, groupId, requestType)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?, ?)
    `);
        const result = stmt.run(
            entry.serverName,
            entry.modelName,
            entry.prompt ?? null,
            entry.responseText ?? null,
            entry.responseDurationMs ?? null,
            entry.inputTokens ?? null,
            entry.outputTokens ?? null,
            entry.loadDuration ?? null,
            entry.evalDuration ?? null,
            entry.totalDuration ?? null,
            entry.thinking ?? null,
            entry.messages ?? null,
            entry.toolCalls ?? null,
            entry.temperature ?? null,
            entry.createdAt ?? null,
            entry.responseAt ?? null,
            entry.isError ? 1 : 0,
            entry.groupId ?? null,
            entry.requestType ?? 'generate'
        );

        const lastId = result.lastInsertRowid;
        const newRecord = db.prepare('SELECT * FROM PromptHistory WHERE id = ?').get(lastId) as PromptHistoryRecord;
        if (newRecord) {
            SocketService.emitPromptHistoryAdded(newRecord);
        }

        return lastId;
    }

    static updatePromptHistory(id: number | bigint, update: {
        responseText?: string;
        responseDurationMs?: number;
        inputTokens?: number;
        outputTokens?: number;
        loadDuration?: number;
        evalDuration?: number;
        totalDuration?: number;
        thinking?: string;
        toolCalls?: string;
        responseAt?: string;
        isError?: boolean;
        groupId?: string;
    }) {
        const db = this.getDb();
        const sets: string[] = [];
        const params: any[] = [];

        if (update.responseText !== undefined) {
            sets.push('responseText = ?');
            params.push(update.responseText);
        }
        if (update.responseDurationMs !== undefined) {
            sets.push('responseDurationMs = ?');
            params.push(update.responseDurationMs);
        }
        if (update.inputTokens !== undefined) {
            sets.push('inputTokens = ?');
            params.push(update.inputTokens);
        }
        if (update.outputTokens !== undefined) {
            sets.push('outputTokens = ?');
            params.push(update.outputTokens);
        }
        if (update.loadDuration !== undefined) {
            sets.push('loadDuration = ?');
            params.push(update.loadDuration);
        }
        if (update.evalDuration !== undefined) {
            sets.push('evalDuration = ?');
            params.push(update.evalDuration);
        }
        if (update.totalDuration !== undefined) {
            sets.push('totalDuration = ?');
            params.push(update.totalDuration);
        }
        if (update.thinking !== undefined) {
            sets.push('thinking = ?');
            params.push(update.thinking);
        }
        if (update.toolCalls !== undefined) {
            sets.push('toolCalls = ?');
            params.push(update.toolCalls);
        }
        if (update.responseAt !== undefined) {
            sets.push('responseAt = ?');
            params.push(update.responseAt);
        }
        if (update.isError !== undefined) {
            sets.push('isError = ?');
            params.push(update.isError ? 1 : 0);
        }
        if (update.groupId !== undefined) {
            sets.push('groupId = ?');
            params.push(update.groupId);
        }

        if (sets.length === 0) return;

        const query = `UPDATE PromptHistory SET ${sets.join(', ')} WHERE id = ?`;
        db.prepare(query).run(...params, id);

        const updatedRecord = db.prepare('SELECT * FROM PromptHistory WHERE id = ?').get(id) as PromptHistoryRecord;
        if (updatedRecord) {
            SocketService.emitPromptHistoryUpdated(updatedRecord);
        }
    }

    static async assignGroupIdByPrompt(id: number | bigint, prompt: string) {
        if (!prompt) return;

        const db = this.getDb();
        
        // Find all records with the same prompt
        const matches = db.prepare('SELECT id, groupId FROM PromptHistory WHERE prompt = ?').all(prompt) as { id: number | bigint, groupId: string | null }[];
        
        if (matches.length <= 1) {
            // Only the current record (or none) exists, no need to group
            return;
        }

        // Check if any matching record already has a groupId
        const existingGroup = matches.find(m => m.groupId !== null);
        const groupId = existingGroup ? existingGroup.groupId : randomUUID();

        // Update all records with the same prompt that don't have this groupId yet
        const toUpdate = matches.filter(m => m.groupId !== groupId);
        
        if (toUpdate.length > 0) {
            const updateStmt = db.prepare('UPDATE PromptHistory SET groupId = ? WHERE id = ?');
            const transaction = db.transaction((items: { id: number | bigint }[]) => {
                for (const item of items) {
                    updateStmt.run(groupId, item.id);
                }
            });
            
            transaction(toUpdate);

            // Emit updates for all changed records
            for (const item of toUpdate) {
                const updatedRecord = db.prepare('SELECT * FROM PromptHistory WHERE id = ?').get(item.id) as PromptHistoryRecord;
                if (updatedRecord) {
                    SocketService.emitPromptHistoryUpdated(updatedRecord);
                }
            }
            
            LogService.debug(`Assigned groupId ${groupId} to ${toUpdate.length} records for prompt: ${prompt.substring(0, 50)}...`);
        }
    }

    static getPromptHistory(query: PromptHistoryQuery): { total: number; records: PromptHistoryRecord[]; } {
        const db = this.getDb();
        const whereClauses: string[] = [];
        const params: any[] = [];

        if (query.modelName) {
            whereClauses.push('modelName = ?');
            params.push(query.modelName);
        }

        if (query.serverName) {
            whereClauses.push('serverName = ?');
            params.push(query.serverName);
        }

        if (query.groupId) {
            whereClauses.push('groupId = ?');
            params.push(query.groupId);
        }

        if (query.requestType) {
            whereClauses.push('requestType = ?');
            params.push(query.requestType);
        }

        if (query.isError !== undefined) {
            whereClauses.push('isError = ?');
            params.push(query.isError ? 1 : 0);
        }

        if (query.createdAfter) {
            whereClauses.push('createdAt >= ?');
            params.push(query.createdAfter);
        }

        if (query.createdBefore) {
            whereClauses.push('createdAt <= ?');
            params.push(query.createdBefore);
        }

        if (query.durationGt !== undefined) {
            whereClauses.push('responseDurationMs > ?');
            params.push(query.durationGt);
        }

        if (query.durationLt !== undefined) {
            whereClauses.push('responseDurationMs < ?');
            params.push(query.durationLt);
        }

        const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const totalRow = db.prepare(`SELECT COUNT(*) as count FROM PromptHistory ${where}`).get(...params) as { count: number };

        const sortColumnMap: Record<string, string> = {
            createdAt: 'createdAt',
            responseDurationMs: 'responseDurationMs',
            serverName: 'serverName',
            modelName: 'modelName',
            totalDuration: 'totalDuration',
            evalDuration: 'evalDuration',
        };

        const sortColumn = sortColumnMap[query.sort] || 'createdAt';
        const direction = query.direction === 'ASC' ? 'ASC' : 'DESC';

        const records = db.prepare(
            `SELECT * FROM PromptHistory ${where} ORDER BY ${sortColumn} ${direction} LIMIT ? OFFSET ?`
        ).all(...params, query.limit, query.offset) as PromptHistoryRecord[];

        return {
            total: totalRow.count,
            records,
        };
    }
}
