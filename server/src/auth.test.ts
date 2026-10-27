import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connect } from 'node:net';
import { authCookies, clearedAuthCookies, readAuthCookie } from './auth.js';
import {
  createTestFixture,
  disposeTestFixture,
  reopenTestFixture,
} from './test-helper.js';

const day = 24 * 60 * 60_000;

test('pairing protects the matched route for raw absolute-form HTTP requests', async (t) => {
  const fixture = await createTestFixture({ loginEnabled: true });
  t.after(() => disposeTestFixture(fixture));
  await fixture.runtime.app.listen({ host: '127.0.0.1', port: 0 });
  const address = fixture.runtime.app.server.address();
  assert.ok(address !== null && typeof address !== 'string');
  for (const path of ['/api/settings', '/api/dependencies', '/api/bootstrap']) {
    for (const target of [path, `http://localhost${path}?probe=1`]) {
      const response = await new Promise<string>((resolve, reject) => {
        let data = '';
        const socket = connect(address.port, '127.0.0.1', () => {
          socket.end(
            `GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
          );
        });
        socket.setTimeout(5_000, () =>
          socket.destroy(new Error('Request timed out')),
        );
        socket.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        socket.on('end', () => resolve(data));
        socket.on('error', reject);
      });
      assert.match(response, /^HTTP\/1\.1 401 /u, target);
      assert.doesNotMatch(response, /mcpServers|expectedRevision/u);
    }
  }
});

test('login-disabled APIs reject foreign Host authorities and every API write checks Origin', async (t) => {
  for (const loginEnabled of [false, true]) {
    const fixture = await createTestFixture({ loginEnabled });
    t.after(() => disposeTestFixture(fixture));
    const app = fixture.runtime.app;
    if (!loginEnabled) {
      for (const host of [
        'attacker.invalid',
        'localhost.attacker.invalid',
        '127.0.0.1.attacker.invalid',
      ]) {
        assert.equal(
          (await app.inject({ url: '/api/settings', headers: { host } }))
            .statusCode,
          403,
        );
      }
      for (const host of ['localhost', '127.0.0.1:3000', '[::1]:3000']) {
        assert.equal(
          (await app.inject({ url: '/api/settings', headers: { host } }))
            .statusCode,
          200,
        );
      }
    }
    for (const url of [
      '/api/dependencies',
      '/api/capabilities/refresh',
      '/api/auth/exchange',
      '/api/auth/logout',
    ]) {
      for (const origin of [
        'http://attacker.invalid',
        'https://localhost',
        'null',
        'malformed',
      ]) {
        assert.equal(
          (
            await app.inject({
              method: url === '/api/dependencies' ? 'PUT' : 'POST',
              url,
              headers: { host: 'localhost', origin },
            })
          ).statusCode,
          403,
        );
      }
    }
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/logout',
          headers: { host: 'localhost', origin: 'http://localhost' },
        })
      ).statusCode,
      204,
    );
  }
});

test('browser activity renews one login, applies current policy, and preserves revocation and restart cleanup', async (context) => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const fixture = await createTestFixture({
    loginEnabled: true,
    clock: () => now,
  });
  let runtime = fixture.runtime;
  context.after(() => runtime.close());
  runtime.auth.setOwnerKey('TESTOWNERKEY123456789');
  async function login() {
    const result = await runtime.app.inject({
      method: 'POST',
      url: '/api/auth/exchange',
      payload: { credential: 'TESTOWNERKEY123456789' },
    });
    assert.equal(result.statusCode, 200);
    return {
      cookie: String(result.headers['set-cookie']).split(';')[0] ?? '',
      body: result.json<{ expiresAt: string | null }>(),
    };
  }
  async function settings(cookie: string) {
    const response = await runtime.app.inject({
      url: '/api/settings',
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200);
    return response.json<{
      value: { application: { browserLoginExpiryDays: number } };
      revision: string;
    }>();
  }
  async function policy(cookie: string, days: number) {
    const current = await settings(cookie);
    current.value.application.browserLoginExpiryDays = days;
    const response = await runtime.app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: { cookie },
      payload: { value: current.value, expectedRevision: current.revision },
    });
    assert.equal(response.statusCode, 200);
  }
  const first = await login();
  assert.equal(first.body.expiresAt, '2026-01-31T00:00:00.000Z');
  now = new Date('2026-01-30T00:00:00.000Z');
  const resumed = await runtime.app.inject({
    url: '/api/auth/status',
    headers: { cookie: first.cookie },
  });
  assert.equal(resumed.json<{ authenticated: boolean }>().authenticated, true);
  assert.match(
    String(resumed.headers['set-cookie']),
    /Expires=Sun, 01 Mar 2026/u,
  );
  assert.equal(
    String(resumed.headers['set-cookie']).split(';')[0],
    first.cookie,
  );
  now = new Date('2026-02-01T00:00:00.000Z');
  await settings(first.cookie);
  await policy(first.cookie, 0);
  const forever = await login();
  assert.equal(forever.body.expiresAt, null);
  const permanent = await runtime.app.inject({
    url: '/api/settings',
    headers: { cookie: first.cookie },
  });
  assert.doesNotMatch(
    String(permanent.headers['set-cookie']),
    /Expires=|Max-Age=/u,
  );
  await policy(first.cookie, 1);
  await settings(first.cookie);
  const short = await login();
  // Existing permanent logins adopt the dated policy on their next use.
  const dated = await runtime.app.inject({
    url: '/api/settings',
    headers: { cookie: forever.cookie },
  });
  assert.match(
    String(dated.headers['set-cookie']),
    /Expires=Mon, 02 Feb 2026/u,
  );
  now = new Date(now.getTime() + day - 1);
  await settings(short.cookie);
  now = new Date(now.getTime() + 1);
  await settings(short.cookie);
  // These inactive logins expire exactly at their stored deadline.
  for (const cookie of [first.cookie, forever.cookie]) {
    const expired = await runtime.app.inject({
      url: '/api/settings',
      headers: { cookie },
    });
    assert.equal(expired.statusCode, 401);
    assert.equal(expired.headers['set-cookie'], undefined);
  }
  await policy(short.cookie, 0);
  await settings(short.cookie);
  await runtime.close();
  runtime = (
    await reopenTestFixture({ root: fixture.root, faux: fixture.faux })
  ).runtime;
  assert.deepEqual(
    runtime.storage.connection
      .prepare('SELECT count(*) AS n FROM auth_sessions')
      .get(),
    { n: 1 },
  );
  forever.cookie = short.cookie;
  await settings(forever.cookie);
  const other = await login();
  for (const headers of [
    {},
    { cookie: 'simplebot_session=invalid' },
    { cookie: first.cookie },
  ]) {
    assert.equal(
      (
        await runtime.app.inject({
          method: 'POST',
          url: '/api/auth/purge-others',
          headers,
        })
      ).statusCode,
      401,
    );
  }
  assert.equal(
    (
      await runtime.app.inject({
        method: 'POST',
        url: '/api/auth/purge-others?test=1',
        headers: {
          cookie: forever.cookie,
          origin: 'https://elsewhere.example',
        },
      })
    ).statusCode,
    403,
  );
  await settings(other.cookie);
  assert.equal(
    (
      await runtime.app.inject({
        method: 'POST',
        url: '/api/auth/purge-others',
        headers: { cookie: forever.cookie },
      })
    ).statusCode,
    204,
  );
  await settings(forever.cookie);
  assert.equal(
    (
      await runtime.app.inject({
        url: '/api/settings',
        headers: { cookie: other.cookie },
      })
    ).statusCode,
    401,
  );
  await runtime.app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { cookie: forever.cookie },
  });
  runtime.auth.cleanup();
  assert.equal(
    (
      runtime.storage.connection
        .prepare('SELECT count(*) AS n FROM auth_sessions')
        .get() as { n: number }
    ).n,
    0,
  );
});

test('idle daily housekeeping removes expired and revoked logins and spent pairing codes', async (context) => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  context.mock.timers.enable({ apis: ['setInterval'] });
  const { runtime } = await createTestFixture({ clock: () => now });
  context.after(() => runtime.close());
  runtime.auth.setOwnerKey('TESTOWNERKEY123456789');
  const login = runtime.auth.exchange('TESTOWNERKEY123456789', now, 1);
  assert.ok(login);
  const consumed = runtime.auth.issuePairingCode(now);
  const expiredCode = runtime.auth.issuePairingCode(now);
  assert.ok(runtime.auth.exchange(consumed.code, now, 0));
  const revoked = runtime.auth.exchange('TESTOWNERKEY123456789', now, 0);
  assert.ok(revoked);
  runtime.auth.revoke(revoked.token, now);
  now = new Date(now.getTime() + day);
  assert.equal(runtime.auth.exchange(expiredCode.code, now), null);
  assert.equal(runtime.auth.verify(login.token, now), false);
  context.mock.timers.tick(day);
  assert.deepEqual(
    runtime.storage.connection
      .prepare('SELECT count(*) AS n FROM auth_pairing_codes')
      .get(),
    { n: 0 },
  );
  assert.equal(
    (
      runtime.storage.connection
        .prepare('SELECT count(*) AS n FROM auth_sessions')
        .get() as { n: number }
    ).n,
    1,
  );
  assert.equal(
    (
      await runtime.app.inject({
        method: 'POST',
        url: '/api/auth/purge-others',
      })
    ).statusCode,
    401,
  );
});

test('cookie selection follows transport regardless of header order and HTTPS clears the plain cookie', () => {
  for (const cookie of [
    'simplebot_session=plain; __Host-simplebot_session=secure',
    '__Host-simplebot_session=secure; simplebot_session=plain',
  ]) {
    assert.equal(readAuthCookie(cookie, true), 'secure');
    assert.equal(readAuthCookie(cookie, false), 'plain');
  }
  assert.equal(readAuthCookie('simplebot_session=plain', true), undefined);
  assert.equal(
    readAuthCookie('__Host-simplebot_session=secure', false),
    undefined,
  );
  assert.deepEqual(authCookies('token', null, true), [
    '__Host-simplebot_session=token; Path=/; HttpOnly; SameSite=Strict; Secure',
    'simplebot_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict',
  ]);
  assert.equal(clearedAuthCookies(true).length, 2);
});

test('private requests and streams renew cookies; public requests and rejected origins do not', async (context) => {
  let now = new Date('2026-01-01T00:00:00.000Z');
  const { runtime } = await createTestFixture({
    loginEnabled: true,
    clock: () => now,
  });
  context.after(() => runtime.close());
  runtime.auth.setOwnerKey('TESTOWNERKEY123456789');
  const issued = runtime.auth.exchange('TESTOWNERKEY123456789', now);
  assert.ok(issued);
  const cookie = `simplebot_session=${issued.token}`;
  const rows = () =>
    runtime.storage.connection.prepare('SELECT * FROM auth_sessions').all();
  const original = rows();
  now = new Date('2026-01-02T12:34:56.000Z');
  for (const url of ['/api/health', '/']) {
    const response = await runtime.app.inject({ url, headers: { cookie } });
    assert.equal(response.headers['set-cookie'], undefined);
  }
  const rejected = await runtime.app.inject({
    method: 'POST',
    url: '/api/auth/purge-others',
    headers: { cookie, origin: 'https://elsewhere.example' },
  });
  assert.equal(rejected.statusCode, 403);
  assert.equal(rejected.headers['set-cookie'], undefined);
  assert.deepEqual(rows(), original);
  const created = await runtime.app.inject({
    method: 'POST',
    url: '/api/sessions',
    headers: { cookie },
    payload: { botSlug: 'echo' },
  });
  assert.equal(created.statusCode, 201);
  now = new Date(now.getTime() + 1000);
  const stream = await runtime.app.inject({
    method: 'POST',
    url: `/api/sessions/${created.json<{ id: string }>().id}/attempts`,
    headers: { cookie },
    payload: { kind: 'reply', text: 'Hello' },
  });
  assert.equal(stream.statusCode, 200);
  assert.match(String(stream.headers['content-type']), /text\/event-stream/u);
  assert.match(
    String(stream.headers['set-cookie']),
    /Expires=Sun, 01 Feb 2026 12:34:57 GMT/u,
  );
  assert.equal(String(stream.headers['set-cookie']).split(';')[0], cookie);
  assert.equal(rows().length, 1);
  assert.deepEqual(
    runtime.storage.connection
      .prepare('SELECT expires_at FROM auth_sessions')
      .get(),
    { expires_at: '2026-02-01T12:34:57.000Z' },
  );
  now = new Date('2026-02-01T12:34:57.000Z');
  assert.equal(runtime.auth.renew(issued.token, now, 0), null);
  assert.equal(runtime.auth.renew(issued.token, now, 365), null);
  const status = await runtime.app.inject({
    url: '/api/auth/status',
    headers: { cookie },
  });
  assert.equal(status.json<{ authenticated: boolean }>().authenticated, false);
  assert.equal(status.headers['set-cookie'], undefined);
});
