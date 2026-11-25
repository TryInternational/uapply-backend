const http = require('http');
const https = require('https');
const net = require('net');
const { blocked } = require('../../utils/blockNetwork');

// 192.0.2.0/24 is reserved for documentation and is never routed, so even if
// the block failed, nothing real would be reached.
const OUTSIDE_ADDRESS = '192.0.2.1';

const errorFrom = (emitter) =>
  new Promise((resolve) => {
    emitter.on('error', resolve);
  });

describe('blockNetwork', () => {
  test('a raw connection to another machine is refused', async () => {
    const error = await errorFrom(net.connect({ host: OUTSIDE_ADDRESS, port: 443 }));
    expect(error.code).toBe('ENETWORKBLOCKED');
    expect(error.message).toMatch(/Tests must not reach outside this machine/);
  });

  test('an http request to another machine is refused', async () => {
    const error = await errorFrom(http.get(`http://${OUTSIDE_ADDRESS}/`));
    expect(error.code).toBe('ENETWORKBLOCKED');
  });

  test('an https request to a named host is refused before anything is looked up', async () => {
    const error = await errorFrom(https.get('https://api.invalid/v1/messages'));
    expect(error.code).toBe('ENETWORKBLOCKED');
    expect(error.message).toMatch(/api\.invalid:443/);
  });

  test('a connection given as port and host is refused too', async () => {
    const error = await errorFrom(net.connect(443, OUTSIDE_ADDRESS));
    expect(error.code).toBe('ENETWORKBLOCKED');
  });

  test('every refused attempt is recorded', () => {
    expect(blocked).toEqual(expect.arrayContaining([`${OUTSIDE_ADDRESS}:443`, 'api.invalid:443']));
  });

  test('a connection that stays on this machine is allowed', async () => {
    const server = net.createServer((socket) => socket.end('ok'));
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    const reply = await new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port: server.address().port });
      let data = '';
      socket.on('data', (chunk) => {
        data += chunk;
      });
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });
    await new Promise((resolve) => {
      server.close(resolve);
    });
    expect(reply).toBe('ok');
  });
});
