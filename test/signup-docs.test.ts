import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';

describe('swagger and signup validation', () => {
  const app = buildApp();

  it('serves swagger UI at /docs', async () => {
    const response = await request(app).get('/docs/');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('documents the signup endpoint', async () => {
    const response = await request(app).get('/docs/json');
    const spec = response.body;
    expect(Object.keys(spec.paths['/auth/email/signup'].post.responses)).toEqual(['200', '400', '409']);
  });

  it.each([
    { email: 'not-an-email', password: 'long-enough-pass' },
    { email: 'a@example.com', password: 'short' },
    {},
  ])('returns 400 for invalid input %j', async (payload) => {
    const response = await request(app).post('/auth/email/signup').send(payload);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Please check email or password invalid' });
  });
});
