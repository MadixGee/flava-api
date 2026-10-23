import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';

// Health liveness is independent of database availability.
describe('GET /health/live', () => {
  const app = buildApp();

  it('returns an OK status', async () => {
    const response = await request(app).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
