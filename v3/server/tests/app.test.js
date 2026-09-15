// App-level smoke tests — models are mocked so this suite never needs a live MongoDB connection.
// Covers STEP 18: a direct API call with no token must be rejected by the API itself, never by a
// UI button being hidden — proven here at the route level, with no UI in the loop at all.
jest.mock('../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../src/models/Company', () => ({ findById: jest.fn() }));

const request = require('supertest');
const { app } = require('../src/app/app');

describe('GET /api/v3/health', () => {
  test('200, no auth required', async () => {
    const res = await request(app).get('/api/v3/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /api/v3/me — direct API access, no UI in the loop', () => {
  test('401 with no Authorization header', async () => {
    const res = await request(app).get('/api/v3/me');
    expect(res.status).toBe(401);
  });

  test('401 with a garbage token', async () => {
    const res = await request(app).get('/api/v3/me').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});

describe('unknown route', () => {
  test('404 for a route with no handler', async () => {
    const res = await request(app).get('/api/v3/does-not-exist');
    expect(res.status).toBe(404);
  });
});
