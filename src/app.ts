import 'dotenv/config';
import express from 'express';
import path from 'path';
import { createServer } from 'http';
import { LogService } from './services/LogService';
import { ConfigService } from './services/ConfigService';
import { DbService } from './services/DbService';
import { ServerPoolService } from './services/ServerPoolService';
import { SocketService } from './services/SocketService';
import { serverRoutes } from './routes/serverRoutes';
import { modelRoutes } from './routes/modelRoutes';
import { promptRoutes } from './routes/promptRoutes';
import { historyRoutes } from './routes/historyRoutes';

const app = express();
const httpServer = createServer(app);
ConfigService.loadConfig();
const PORT = ConfigService.getPort();

app.use(express.json());

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

// Routes
app.use('/api', serverRoutes);
app.use('/api', modelRoutes);
app.use('/api', promptRoutes);
app.use('/api', historyRoutes);

// Error Handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    LogService.error('Unhandled error', { error: err });
    res.status(500).json({ error: 'Internal Server Error' });
});

async function start() {
    try {
        // Initialize Services
        ConfigService.loadConfig();
        DbService.initialize();
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
