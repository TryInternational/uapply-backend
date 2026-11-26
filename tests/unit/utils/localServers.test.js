const http = require('http');
const request = require('supertest');
const express = require('express');
const { LOCAL } = require('../../utils/localServers');

const closed = (server) =>
  new Promise((resolve) => {
    server.close(resolve);
  });
const listening = (server, ...args) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(...args, () => resolve(server.address()));
  });

describe('servers started by tests', () => {
  test('one asked for on any port listens on this machine alone', async () => {
    const server = http.createServer();

    const address = await listening(server, 0);
    await closed(server);

    expect(address.address).toBe(LOCAL);
    expect(address.port).toBeGreaterThan(0);
  });

  test('it has its port by the time it is asked for, as supertest needs', async () => {
    const server = http.createServer();

    server.listen(0);
    const address = server.address();
    await closed(server);

    expect(address).toMatchObject({ address: LOCAL, family: 'IPv4' });
  });

  test('the same is true of the server supertest starts for a request', async () => {
    const app = express();
    let heardOn;
    app.get('/where', (req, res) => {
      heardOn = req.socket.server.address().address;
      res.send('here');
    });

    await request(app).get('/where').expect(200, 'here');

    expect(heardOn).toBe(LOCAL);
  });

  test('one that names its address is left as it is', async () => {
    const server = http.createServer();

    const address = await listening(server, 0, 'localhost');
    await closed(server);

    expect(['127.0.0.1', '::1']).toContain(address.address);
  });

  test('one that names its port is left as it is', async () => {
    const first = http.createServer();
    const { port } = await listening(first, 0);
    await closed(first);
    const server = http.createServer();

    const address = await listening(server, port);
    await closed(server);

    expect(address.port).toBe(port);
    expect(address.address).not.toBe(LOCAL);
  });
});
