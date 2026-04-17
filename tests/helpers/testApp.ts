import express from 'express';

/**
 * Creates a minimal Express app for route testing.
 * Mounts the provided router at the given prefix.
 */
export function createTestApp(router: express.Router, prefix = '/api'): express.Express {
    const app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use(prefix, router);

    // Error handler
    app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ error: 'Internal Server Error' });
    });

    return app;
}
