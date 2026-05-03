/**
 * Embedded Express server — handles capture + recording API.
 *
 * Boots from electron/main.ts after `app.whenReady()`. Listens on a fixed local port
 * (the capture window hardcodes the matching port). Pure HTTP — no SSE, no auth, no
 * external bindings (loopback only).
 */

import express from 'express';
import type { Server } from 'http';
import { recordingsRouter } from './routes/recordings.js';
import { captureRouter } from './routes/capture.js';

export const ECHO_SERVER_PORT = 3739;

let server: Server | null = null;

export function startServer(): Promise<Server> {
  if (server) return Promise.resolve(server);

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', recordingsRouter);
  app.use('/api', captureRouter);
  app.get('/api/health', (_req, res) => res.json({ ok: true }));

  return new Promise((resolve, reject) => {
    const s = app.listen(ECHO_SERVER_PORT, '127.0.0.1', () => {
      console.log(`[server] Echo listening on http://127.0.0.1:${ECHO_SERVER_PORT}`);
      server = s;
      resolve(s);
    });
    s.on('error', reject);
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => {
      server = null;
      resolve();
    });
  });
}
