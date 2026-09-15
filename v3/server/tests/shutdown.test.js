// Unit test for graceful shutdown (PHASE 1 STEP: graceful shutdown) — verifies the shutdown
// sequence itself (stop accepting connections, then close the isolated DB connection) without
// spinning up a real socket or a real MongoDB connection. Each test loads its own fresh module
// instance (jest.isolateModules) so the internal "already shutting down" guard doesn't carry over
// between the two scenarios below, and so each test's mocked disconnectV3DB is the exact one
// gracefulShutdown() actually calls (not a separately-resolved, unmocked copy).
jest.mock('../src/models/User', () => ({ findById: jest.fn() }));
jest.mock('../src/models/Company', () => ({ findById: jest.fn() }));

function loadIndexWithMockedDb(disconnectImpl) {
  let result;
  jest.isolateModules(() => {
    jest.doMock('../src/db/connection', () => ({
      connectV3DB: jest.fn().mockResolvedValue({}),
      disconnectV3DB: jest.fn(disconnectImpl),
    }));
    const indexModule = require('../src/index');
    const dbModule = require('../src/db/connection');
    result = { gracefulShutdown: indexModule.gracefulShutdown, disconnectV3DB: dbModule.disconnectV3DB };
  });
  return result;
}

describe('gracefulShutdown', () => {
  test('closes the HTTP server before closing the DB connection, then exits(0)', async () => {
    const order = [];
    const { gracefulShutdown, disconnectV3DB } = loadIndexWithMockedDb(() => { order.push('db.disconnect'); return Promise.resolve(); });
    const fakeServer = { close: jest.fn((cb) => { order.push('server.close'); cb(); }) };
    const exit = jest.fn();

    await gracefulShutdown('SIGTERM', { serverRef: fakeServer, exit });

    expect(fakeServer.close).toHaveBeenCalledTimes(1);
    expect(disconnectV3DB).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['server.close', 'db.disconnect']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('a server.close() error does not prevent the DB connection from still being closed', async () => {
    const { gracefulShutdown, disconnectV3DB } = loadIndexWithMockedDb(() => Promise.resolve());
    const fakeServer = { close: jest.fn((cb) => cb(new Error('already closed'))) };
    const exit = jest.fn();

    await gracefulShutdown('SIGINT', { serverRef: fakeServer, exit });

    expect(disconnectV3DB).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });
});
