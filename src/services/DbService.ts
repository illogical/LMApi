import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { LogService } from './LogService';
import { SocketService } from './SocketService';

export interface PromptHistoryRecord {
    id: number;
    serverName: string;
    modelName: string;
    prompt?: string;
    responseText?: string;
    responseDurationMs?: number;
    estimatedTokens?: number;
    estimatedOutputTokens?: number;
    temperature?: number;
    createdAt: string;
    responseAt?: string;
    isError: boolean;
    groupId?: string;
}

export interface PromptHistoryQuery {
    limit: number;
    offset: number;
    sort: 'createdAt' | 'responseDurationMs' | 'serverName' | 'modelName';
    direction: 'ASC' | 'DESC';
    modelName?: string;
    serverName?: string;
}

export class DbService {
    private static db: Database.Database;

    static initialize() {
        const dbDir = path.join(process.cwd(), 'data');
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir);
        }

        const dbPath = path.join(dbDir, 'history.db');
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
        estimatedTokens INTEGER,
        estimatedOutputTokens INTEGER,
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

        // Add estimatedOutputTokens column if it doesn't exist
        try {
            this.db.exec('ALTER TABLE PromptHistory ADD COLUMN estimatedOutputTokens INTEGER');
            LogService.info('Added estimatedOutputTokens column to PromptHistory table');
        } catch (err: any) {
            if (!err.message.includes('duplicate column')) {
                LogService.warn('Migration warning (estimatedOutputTokens): ' + err.message);
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

    static insertPromptHistory(entry: {
        serverName: string;
        modelName: string;
        prompt?: string;
        responseText?: string;
        responseDurationMs?: number;
        estimatedTokens?: number;
        estimatedOutputTokens?: number;
        temperature?: number;
        createdAt?: string;
        responseAt?: string;
        isError?: boolean;
        groupId?: string;
    }) {
        const db = this.getDb();
        const stmt = db.prepare(`
      INSERT INTO PromptHistory (serverName, modelName, prompt, responseText, responseDurationMs, estimatedTokens, estimatedOutputTokens, temperature, createdAt, responseAt, isError, groupId)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?, ?)
    `);
        const result = stmt.run(
            entry.serverName,
            entry.modelName,
            entry.prompt ?? null,
            entry.responseText ?? null,
            entry.responseDurationMs ?? null,
            entry.estimatedTokens ?? null,
            entry.estimatedOutputTokens ?? null,
            entry.temperature ?? null,
            entry.createdAt ?? null,
            entry.responseAt ?? null,
            entry.isError ? 1 : 0,
            entry.groupId ?? null
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
        estimatedTokens?: number;
        estimatedOutputTokens?: number;
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
        if (update.estimatedTokens !== undefined) {
            sets.push('estimatedTokens = ?');
            params.push(update.estimatedTokens);
        }
        if (update.estimatedOutputTokens !== undefined) {
            sets.push('estimatedOutputTokens = ?');
            params.push(update.estimatedOutputTokens);
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

        const where = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

        const totalRow = db.prepare(`SELECT COUNT(*) as count FROM PromptHistory ${where}`).get(...params) as { count: number };

        const sortColumnMap: Record<string, string> = {
            createdAt: 'createdAt',
            responseDurationMs: 'responseDurationMs',
            serverName: 'serverName',
            modelName: 'modelName',
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
