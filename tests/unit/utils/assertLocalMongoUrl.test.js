/**
 * The database tests wipe every collection, so they may only ever connect to a
 * MongoDB on this machine.
 */
const { assertLocalMongoUrl, isLocalMongoUrl } = require('../../utils/assertLocalMongoUrl');

describe('assertLocalMongoUrl', () => {
  test('a local MongoDB is accepted', () => {
    expect(isLocalMongoUrl('mongodb://127.0.0.1:27017/app-test')).toBe(true);
    expect(isLocalMongoUrl('mongodb://localhost/app-test')).toBe(true);
    expect(isLocalMongoUrl('mongodb://localhost:27017,127.0.0.1:27018/app-test?replicaSet=rs0')).toBe(true);
    expect(isLocalMongoUrl('mongodb://[::1]:27017/app-test')).toBe(true);
    expect(isLocalMongoUrl('mongodb://user:pass@localhost:27017/app-test')).toBe(true);
    expect(() => assertLocalMongoUrl('mongodb://127.0.0.1:27017/app-test')).not.toThrow();
  });

  test('a hosted cluster is refused, with or without "-test" on the end', () => {
    expect(isLocalMongoUrl('mongodb+srv://user:pass@cluster.example.net/app')).toBe(false);
    expect(isLocalMongoUrl('mongodb+srv://user:pass@cluster.example.net/app-test')).toBe(false);
    // the suffix landed in the options: the database name is unchanged
    expect(isLocalMongoUrl('mongodb+srv://user:pass@cluster.example.net/app?retryWrites=true-test')).toBe(false);
    expect(isLocalMongoUrl('mongodb://user:pass@db.example.net:27017/app-test')).toBe(false);
  });

  test('one remote host among local ones is refused', () => {
    expect(isLocalMongoUrl('mongodb://localhost:27017,db.example.net:27017/app-test')).toBe(false);
  });

  test('a host that only looks local is refused', () => {
    expect(isLocalMongoUrl('mongodb://localhost.example.net/app-test')).toBe(false);
    expect(isLocalMongoUrl('mongodb://user:pass@127.0.0.1.example.net/app-test')).toBe(false);
    expect(isLocalMongoUrl('mongodb+srv://localhost/app-test')).toBe(false);
  });

  test('nothing, or something that is not a MongoDB URL, is refused', () => {
    expect(isLocalMongoUrl('')).toBe(false);
    expect(isLocalMongoUrl(undefined)).toBe(false);
    expect(isLocalMongoUrl('undefined-test')).toBe(false);
    expect(isLocalMongoUrl('http://localhost:27017')).toBe(false);
  });

  test('the error never repeats the URL, which holds a password', () => {
    const url = 'mongodb+srv://someone:s3cret-pass@cluster.example.net/app';
    let message = '';
    try {
      assertLocalMongoUrl(url);
    } catch (e) {
      message = e.message;
    }
    expect(message).toMatch(/Refusing to run database tests/);
    expect(message).not.toContain('s3cret-pass');
    expect(message).not.toContain('cluster.example.net');
  });
});
