import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { buildRouter } from '../../src/app';

/**
 * Confirms buildRouter()'s output behaves correctly when mounted under a
 * HomeBase-style basePath prefix (docs/plans/2026-08-16-homebase-integration.md,
 * phase 4/8): HomeBase does `app.use(basePath, router)` — buildRouter() must
 * never itself add that prefix (double-mount risk), and the injected
 * `<base href>` must reflect the mount point so page-relative dashboard
 * assets resolve correctly.
 */
function mountHosted(basePath: string): express.Express {
    const app = express();
    app.use(basePath, buildRouter(basePath));
    return app;
}

describe('base-path-aware mounting', () => {
    it('serves the dashboard at the basePath root with a matching <base href>', async () => {
        const app = mountHosted('/lmapi/');
        const res = await request(app).get('/lmapi/');

        expect(res.status).toBe(200);
        expect(res.text).toContain('<base href="/lmapi/">');
    });

    it('is not reachable at the bare root once mounted under a basePath', async () => {
        const app = mountHosted('/lmapi/');
        const res = await request(app).get('/');

        expect(res.status).toBe(404);
    });

    it('serves the OpenAPI spec with servers[0].url rewritten to the basePath', async () => {
        const app = mountHosted('/lmapi/');
        const res = await request(app).get('/lmapi/api-docs.json');

        expect(res.status).toBe(200);
        expect(res.body.servers[0].url).toBe('/lmapi/');
    });

    it('keeps the root-level OpenAI-compatible endpoint reachable under the basePath', async () => {
        const app = mountHosted('/lmapi/');
        const res = await request(app).post('/lmapi/v1/chat/completions').send({});

        // Validated by Zod before any service is touched — an empty body is a
        // 400, not a 404, confirming the route itself is mounted correctly.
        expect(res.status).toBe(400);
    });

    it('standalone mode (basePath "/") is unaffected by the same buildRouter()', async () => {
        const app = express();
        app.use(buildRouter('/'));
        const res = await request(app).get('/');

        expect(res.status).toBe(200);
        expect(res.text).toContain('<base href="/">');
    });
});
