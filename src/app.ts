import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer } from 'http';
import { LogService } from './services/LogService';
import { ConfigService } from './services/ConfigService';
import { DbService } from './services/DbService';
import { ServerPoolService } from './services/ServerPoolService';
import { SocketService } from './services/SocketService';
import { ProviderService } from './services/ProviderService';
import { serverRoutes } from './routes/serverRoutes';
import { modelRoutes } from './routes/modelRoutes';
import { promptRoutes } from './routes/promptRoutes';
import { historyRoutes } from './routes/historyRoutes';
import { agentRoutes } from './routes/agentRoutes';
import { chatCompletionRoutes } from './routes/chatCompletionRoutes';
import { requestRoutes } from './routes/requestRoutes';
import { healthRoutes } from './routes/healthRoutes';
import { evaluateRoutes } from './routes/evaluateRoutes';
import { RequestRegistryService } from './services/RequestRegistryService';
import { setupSwagger } from './swagger';
import { AppPaths } from './config/AppPaths';

/**
 * Sends a dashboard HTML page with a `<base href>` tag injected so every
 * page-relative asset URL, fetch() call, and nav link resolves correctly
 * whether mounted at standalone's `/` or a hosted `basePath` like `/lmapi/`
 * (HomeBase mounts this app's router under that prefix; nothing in this
 * router adds it). See docs/plans/2026-08-16-homebase-integration.md phase 4.
 */
function sendHtmlWithBasePath(res: express.Response, filePath: string, basePath: string): void {
    const html = fs.readFileSync(filePath, 'utf-8');
    res.type('html').send(html.replace('<head>', `<head>\n  <base href="${basePath}">`));
}

/**
 * Constructs the Express app and HTTP server, mounting all middleware,
 * static assets, and routes. Performs no I/O (beyond the dashboard's
 * per-request HTML read/template above) and starts no services — safe to
 * call from any entry point (standalone or hosted).
 *
 * `basePath` is never used to prefix routes here — in hosted mode HomeBase
 * mounts the returned router itself (`app.use(basePath, router)`), so
 * double-prefixing internally would break routing. It's only used to
 * generate the `<base href>` tag the dashboard's client-side assets rely on.
 */
export function buildApp(basePath: string = '/'): { app: express.Express; httpServer: ReturnType<typeof createServer> } {
    const app = express();
    const httpServer = createServer(app);

    app.use(express.json({ limit: '10mb' }));

    // Logging Middleware
    app.use((req, res, next) => {
        LogService.trace(`${req.method} ${req.url}`);
        next();
    });

    // Serve static assets from src/public so the dashboard is same-origin
    const publicDir = AppPaths.getPublicDir();
    app.use(express.static(publicDir));

    // Also serve the scripts directory (for DashboardSocket.ts/js)
    app.use('/scripts', express.static(AppPaths.getScriptsDir()));

    // Friendly route to open the log dashboard
    app.get(['/', '/dashboard'], (_req, res) => {
        sendHtmlWithBasePath(res, path.join(publicDir, 'log-dashboard.html'), basePath);
    });

    app.get('/history', (_req, res) => {
        sendHtmlWithBasePath(res, path.join(publicDir, 'history-browser.html'), basePath);
    });

    app.get('/evaluator', (_req, res) => {
        sendHtmlWithBasePath(res, path.join(publicDir, 'model-evaluator.html'), basePath);
    });

    // API Documentation (Swagger UI)
    setupSwagger(app, basePath);

    // Routes
    app.use('/api', serverRoutes);
    app.use('/api', modelRoutes);
    app.use('/api', promptRoutes);
    app.use('/api', historyRoutes);
    app.use('/api', agentRoutes);
    app.use('/api', chatCompletionRoutes);
    app.use('/api', requestRoutes);
    app.use('/api', evaluateRoutes);
    app.use('/', healthRoutes);

    // OpenAI-compatible endpoint (not under /api prefix)
    app.use('/', chatCompletionRoutes);

    // Error Handling
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (err.type === 'entity.too.large') {
            LogService.warn('Request body too large', { url: req.url, method: req.method, length: err.length, limit: err.limit });
            DbService.insertPromptHistory({
                serverName: '(middleware)',
                modelName: '(unknown)',
                prompt: `${req.method} ${req.url}`,
                responseText: `Request body too large: ${err.length} bytes exceeds ${err.limit} byte limit`,
                responseAt: new Date().toISOString(),
                isError: true,
                requestType: 'chat',
            });
            res.status(413).json({ error: err.message, type: err.type, length: err.length, limit: err.limit });
            return;
        }
        LogService.error('Unhandled error', { error: err });
        res.status(500).json({ error: 'Internal Server Error' });
    });

    return { app, httpServer };
}

async function start() {
    try {
        LogService.initializeFileLogging();
        ConfigService.loadConfig();
        const PORT = ConfigService.getPort();
        const basePath = '/'; // Standalone is always root-mounted; hosted mode (phase 7) passes HomeBase's basePath instead.
        const { httpServer } = buildApp(basePath);

        // Initialize Services
        DbService.initialize();
        ProviderService.initialize();
        SocketService.initialize(httpServer, basePath);
        await ServerPoolService.initialize();

        // Prune completed registry entries every 60s
        const pruneInterval = setInterval(() => RequestRegistryService.pruneCompleted(), 60_000);

        httpServer.listen(PORT, () => {
            LogService.info(`Server running on http://localhost:${PORT}`);
            LogService.info(`Configuration: MAX_PARALLEL_PER_SERVER=${ConfigService.getMaxParallelPerServer()}, SERVER_CHECK_INTERVAL=${ConfigService.getServerCheckIntervalMs()}ms`);
        });

        // Graceful shutdown: release every resource this standalone entry
        // point acquired (mirrors what a future hosted adapter's dispose()
        // does for a HomeBase-managed shutdown). Idempotent since a second
        // signal during shutdown could otherwise re-enter this.
        let shuttingDown = false;
        const shutdown = (signal: string) => {
            if (shuttingDown) return;
            shuttingDown = true;
            LogService.info(`Received ${signal}, shutting down`);
            clearInterval(pruneInterval);
            SocketService.dispose();
            ServerPoolService.dispose();
            DbService.dispose();
            httpServer.close(() => {
                LogService.info('Server closed');
                process.exit(0);
            });
        };
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
    } catch (error) {
        LogService.error('Failed to start server', { error });
        process.exit(1);
    }
}

start();
