import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { LogService } from './LogService';

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
        responseDurationMs INTEGER,
        estimatedTokens INTEGER,
        temperature REAL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
        this.db.exec(createTableQuery);
    }

    static getDb() {
        if (!this.db) {
            this.initialize();
        }
        return this.db;
    }
}
