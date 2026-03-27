import 'dotenv/config';
import express from 'express';
import path from 'path';
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
import { evaluateRoutes } from './routes/evaluateRoutes';

const app = express();
const httpServer = createServer(app);
ConfigService.loadConfig();
const PORT = ConfigService.getPort();

app.use(express.json({ limit: '10mb' }));

// Logging Middleware
app.use((req, res, next) => {
    LogService.trace(`${req.method} ${req.url}`);
    next();
});

// Serve static assets from src/public so the dashboard is same-origin
const publicDir = path.resolve(process.cwd(), 'src', 'public');
app.use(express.static(publicDir));

// Also serve the scripts directory (for DashboardSocket.ts/js)
app.use('/scripts', express.static(path.resolve(process.cwd(), 'scripts')));

// Friendly route to open the log dashboard
app.get(['/', '/dashboard'], (_req, res) => {
    res.sendFile(path.join(publicDir, 'log-dashboard.html'));
});

app.get('/history', (_req, res) => {
    res.sendFile(path.join(publicDir, 'history-browser.html'));
});

app.get('/evaluator', (_req, res) => {
    res.sendFile(path.join(publicDir, 'model-evaluator.html'));
});

// Routes
app.use('/api', serverRoutes);
app.use('/api', modelRoutes);
app.use('/api', promptRoutes);
app.use('/api', historyRoutes);
app.use('/api', agentRoutes);
app.use('/api', chatCompletionRoutes);
app.use('/api', evaluateRoutes);

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

async function start() {
    try {
        // Initialize Services
        ConfigService.loadConfig();
        DbService.initialize();
        ProviderService.initialize();
        SocketService.initialize(httpServer);
        await ServerPoolService.initialize();

        httpServer.listen(PORT, () => {
            LogService.info(`Server running on http://localhost:${PORT}`);
            LogService.info(`Configuration: MAX_PARALLEL_PER_SERVER=${ConfigService.getMaxParallelPerServer()}, SERVER_CHECK_INTERVAL=${ConfigService.getServerCheckIntervalMs()}ms`);
        });
    } catch (error) {
        LogService.error('Failed to start server', { error });
        process.exit(1);
    }
}

start();
