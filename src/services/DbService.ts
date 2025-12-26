import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { LogService } from './LogService';

export interface PromptHistoryRecord {
    id: number;
    serverName: string;
    modelName: string;
    prompt?: string;
    responseText?: string;
    responseDurationMs?: number;
    estimatedTokens?: number;
    temperature?: number;
    createdAt: string;
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
            // Column already exists or other error - ignore if it's a duplicate column error
            if (!err.message.includes('duplicate column')) {
                LogService.warn('Migration warning: ' + err.message);
            }
        }
        
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_PromptHistory_createdAt ON PromptHistory(createdAt DESC)');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_PromptHistory_modelName ON PromptHistory(modelName)');
        this.db.exec('CREATE INDEX IF NOT EXISTS idx_PromptHistory_serverName ON PromptHistory(serverName)');
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
        temperature?: number;
        createdAt?: string;
    }) {
        const db = this.getDb();
        const stmt = db.prepare(`
      INSERT INTO PromptHistory (serverName, modelName, prompt, responseText, responseDurationMs, estimatedTokens, temperature, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);
        const result = stmt.run(
            entry.serverName,
            entry.modelName,
            entry.prompt ?? null,
            entry.responseText ?? null,
            entry.responseDurationMs ?? null,
            entry.estimatedTokens ?? null,
            entry.temperature ?? null,
            entry.createdAt ?? null
        );
        return result.lastInsertRowid;
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
