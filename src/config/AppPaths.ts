import fs from 'fs';
import path from 'path';

/**
 * Central lazy path resolver. Every path getter reads `repositoryRoot`/
 * `dataDir` at call time (not at import time), so `configure()` can be
 * called by a hosted entry point before any service resolves a path.
 * Defaults match today's process.cwd()-relative standalone behavior.
 */
export class AppPaths {
    private static repositoryRoot: string = process.cwd();
    private static dataDir: string = process.cwd();
    private static serversConfigOverridePath: string | undefined;

    static configure(opts: { repositoryRoot?: string; dataDir?: string; serversConfigPath?: string }): void {
        if (opts.repositoryRoot) this.repositoryRoot = opts.repositoryRoot;
        if (opts.dataDir) this.dataDir = opts.dataDir;
        if (opts.serversConfigPath) this.serversConfigOverridePath = opts.serversConfigPath;
    }

    static getRepositoryRoot(): string {
        return this.repositoryRoot;
    }

    static getDataDir(): string {
        return this.dataDir;
    }

    static getPublicDir(): string {
        return path.join(this.repositoryRoot, 'src', 'public');
    }

    static getScriptsDir(): string {
        return path.join(this.repositoryRoot, 'scripts');
    }

    static getProvidersConfigPath(): string {
        return path.join(this.repositoryRoot, 'src', 'config', 'providers.json');
    }

    static getPromptExamplesPath(): string {
        return path.join(this.repositoryRoot, 'src', 'config', 'promptExamples.json');
    }

    static getPromptsDir(): string {
        return path.join(this.repositoryRoot, 'src', 'prompts');
    }

    static getDbPath(): string {
        return path.join(this.dataDir, 'data', 'history.db');
    }

    static getLogsBasePath(): string {
        return path.join(this.dataDir, 'logs', 'log');
    }

    static getReportsDir(): string {
        return path.join(this.dataDir, 'reports');
    }

    /** Read-only shipped template — always under the repo checkout. */
    static getServersConfigTemplatePath(): string {
        return path.join(this.repositoryRoot, 'src', 'config', 'servers.json');
    }

    /**
     * Live, mutable servers.json path. Defaults to the template path
     * itself (standalone: in-place edits). When a hosted entry point
     * configures an override, the first access seeds it by copying from
     * the template if it doesn't exist yet.
     */
    static getServersConfigPath(): string {
        if (!this.serversConfigOverridePath) {
            return this.getServersConfigTemplatePath();
        }
        if (!fs.existsSync(this.serversConfigOverridePath)) {
            fs.mkdirSync(path.dirname(this.serversConfigOverridePath), { recursive: true });
            fs.copyFileSync(this.getServersConfigTemplatePath(), this.serversConfigOverridePath);
        }
        return this.serversConfigOverridePath;
    }
}
