const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { once } = require('events');
const { execFileSync } = require('child_process');

process.env.NODE_ENV = 'test';
process.env.SKIP_AUTH = 'true';
process.env.JWT_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.ADMIN_EMAIL = 'admin@example.com';
process.env.ADMIN_PASSWORD = 'admin123456';

const serverRoot = path.resolve(__dirname, '..');
const CHALLENGE_SEED = 'seed-28';
const CHALLENGE_PREFIX = '0000';
let tempDir;
let buildServer;
let prisma;
let app;

const { parseProxyUrl, buildSiteFetchOptions, siteFetch } = require('../src/site-http');

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

function parseCookies(cookieHeader) {
  const cookies = new Map();
  if (!cookieHeader) return cookies;

  for (const segment of String(cookieHeader).split(';')) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) continue;
    cookies.set(trimmed.slice(0, separatorIndex), trimmed.slice(separatorIndex + 1));
  }

  return cookies;
}

function createUpstreamServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const bodyChunks = [];

    req.on('data', (chunk) => bodyChunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(bodyChunks).toString('utf8');
      requests.push({
        path: url.pathname,
        method: req.method,
        viaProxy: req.headers['x-through-proxy'] === 'yes',
        authorization: req.headers.authorization || '',
        newApiUser: req.headers['new-api-user'] || '',
        accept: req.headers.accept || '',
        origin: req.headers.origin || '',
        referer: req.headers.referer || '',
        contentLength: req.headers['content-length'] || '',
        body: rawBody ? JSON.parse(rawBody) : null
      });

      res.setHeader('Content-Type', 'application/json');

      if (url.pathname === '/v1/models') {
        res.end(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }, { id: 'claude-3-5-sonnet' }] }));
        return;
      }

      if (url.pathname === '/v1/dashboard/billing/subscription') {
        res.end(JSON.stringify({ system_hard_limit_usd: 12.5 }));
        return;
      }

      if (url.pathname === '/v1/dashboard/billing/usage') {
        res.end(JSON.stringify({ total_usage: 250 }));
        return;
      }

      if (url.pathname === '/api/token/') {
        if (req.method === 'GET') {
          res.end(JSON.stringify({ success: true, data: [{ id: 1, key: 'tok-1' }] }));
          return;
        }

        if (req.method === 'PUT') {
          res.end(JSON.stringify({ success: true }));
          return;
        }

        return;
      }

      if (url.pathname === '/api/token/1/key' && req.method === 'POST') {
        res.end(JSON.stringify({
          success: true,
          data: {
            key: 'full-token-key'
          }
        }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ error: `Unhandled path: ${url.pathname}` }));
    });
  });

  return { server, requests };
}

function createVoapiTokenServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const bodyChunks = [];

    req.on('data', (chunk) => bodyChunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(bodyChunks).toString('utf8');
      const requestRecord = {
        path: url.pathname,
        method: req.method,
        authorization: req.headers.authorization || '',
        body: rawBody ? JSON.parse(rawBody) : null
      };

      requests.push(requestRecord);
      res.setHeader('Content-Type', 'application/json');

      if (url.pathname === '/api/keys' && req.method === 'GET') {
        res.end(JSON.stringify({
          code: 0,
          data: {
            records: [{
              id: 1,
              name: 'voapi-token',
              token: '60Wy9oMtcZGCk1jXja0IH8PzqUgvS9moQASE7iM3CjNU6WSt',
              groups: [2],
              expireTime: 4102329600000,
              boundlessAmount: false,
              amount: '1.00',
              used: '0.25',
              enable: true,
              created: 1710000000000,
              updated: 1710003600000,
              uid: 8
            }]
          }
        }));
        return;
      }

      if (url.pathname === '/api/keys/1' && req.method === 'PUT') {
        res.end(JSON.stringify({ code: 0, message: 'ok' }));
        return;
      }

      if (url.pathname === '/api/keys' && req.method === 'POST') {
        res.end(JSON.stringify({ code: 0, message: 'ok' }));
        return;
      }

      if (url.pathname === '/api/keys/1' && req.method === 'DELETE') {
        res.end(JSON.stringify({ code: 0, message: 'ok' }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ code: 404, message: `Unhandled path: ${url.pathname}` }));
    });
  });

  return { server, requests };
}

function createVoapiAccessServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const bodyChunks = [];

    req.on('data', (chunk) => bodyChunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(bodyChunks).toString('utf8');
      requests.push({
        path: url.pathname,
        method: req.method,
        authorization: req.headers.authorization || '',
        body: rawBody ? JSON.parse(rawBody) : null
      });

      res.setHeader('Content-Type', 'application/json');

      if (url.pathname === '/api/check_in' && req.method === 'POST') {
        res.end(JSON.stringify({
          code: 0,
          data: {
            id: 60645,
            created: 1774971285605,
            updated: 1774971285605,
            uid: 520,
            ymd: '20260331',
            amount: '2.85',
            consecutiveNo: 1,
            bonusAmount: '0'
          }
        }));
        return;
      }

      if (url.pathname === '/api/user/info' && req.method === 'GET') {
        res.end(JSON.stringify({
          code: 0,
          data: {
            bindBalance: '8.50',
            basicBalance: '1.50',
            usedBindBalance: '2.00',
            usedBasicBalance: '0.50',
            ban: false
          }
        }));
        return;
      }

      if (url.pathname === '/api/models' && req.method === 'GET') {
        res.end(JSON.stringify({
          code: 0,
          data: {
            models: [
              {
                idKey: 'gpt-4o-mini',
                chargingType: 1,
                inputPrice: '0.10',
                outputPrice: '0.20',
                ac: [1]
              }
            ],
            groups: [
              {
                id: 1,
                name: '默认分组',
                ratio: 1
              }
            ]
          }
        }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ code: 404, message: `Unhandled path: ${url.pathname}` }));
    });
  });

  return { server, requests };
}

function renderBunkerWebChallengeHtml() {
  return `<!doctype html>
<html>
  <head>
    <title>Bot Detection</title>
  </head>
  <body>
    <h1>Please wait while we check if you are a Human</h1>
    <p>Protected by BunkerWeb</p>
    <form method="post" class="hidden" action="/challenge" id="form">
      <input type="hidden" name="challenge" id="challenge" value="" />
    </form>
    <script>
      async function digestMessage(message) {
        return message;
      }
      async function run() {
        let a = 0;
        while (!(await digestMessage("${CHALLENGE_SEED}" + a.toString())).startsWith("${CHALLENGE_PREFIX}")) {
          a += 1;
        }
        document.getElementById("challenge").value = a.toString();
        document.getElementById("form").submit();
      }
      run();
    </script>
  </body>
</html>`;
}

function createBunkerWebProtectedServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const bodyChunks = [];

    req.on('data', (chunk) => bodyChunks.push(chunk));
    req.on('end', () => {
      const cookies = parseCookies(req.headers.cookie);
      const requestBody = Buffer.concat(bodyChunks).toString('utf8');

      requests.push({
        path: url.pathname,
        method: req.method,
        viaProxy: req.headers['x-through-proxy'] === 'yes',
        cookie: req.headers.cookie || '',
        body: requestBody
      });

      if (url.pathname === '/challenge' && req.method === 'GET') {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(renderBunkerWebChallengeHtml());
        return;
      }

      if (url.pathname === '/challenge' && req.method === 'POST') {
        const params = new URLSearchParams(requestBody);
        const challengeValue = params.get('challenge') || '';
        const expectedHash = crypto.createHash('sha256').update(`${CHALLENGE_SEED}${challengeValue}`).digest('hex');
        const targetPath = decodeURIComponent(cookies.get('bw_target') || '/api/user/models');

        if (!expectedHash.startsWith(CHALLENGE_PREFIX)) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end('<html><body><h1>Forbidden</h1><p>BunkerWeb</p></body></html>');
          return;
        }

        res.statusCode = 302;
        res.setHeader('Location', targetPath);
        res.setHeader('Set-Cookie', [
          'bw_verified=1; Path=/',
          'bw_target=; Max-Age=0; Path=/'
        ]);
        res.end();
        return;
      }

      if ((url.pathname === '/api/user/models' || url.pathname === '/api/user/self') && cookies.get('bw_verified') !== '1') {
        res.statusCode = 302;
        res.setHeader('Location', '/challenge');
        res.setHeader('Set-Cookie', `bw_target=${encodeURIComponent(url.pathname)}; Path=/`);
        res.end();
        return;
      }

      res.setHeader('Content-Type', 'application/json');

      if (url.pathname === '/api/user/models') {
        res.end(JSON.stringify({ success: true, data: ['gpt-4o-mini', 'claude-3-5-sonnet'] }));
        return;
      }

      if (url.pathname === '/api/user/self') {
        res.end(JSON.stringify({ success: true, data: { quota: 1250000, used_quota: 250000, status: 1 } }));
        return;
      }

      res.statusCode = 404;
      res.end(JSON.stringify({ success: false, message: `Unhandled path: ${url.pathname}` }));
    });
  });

  return { server, requests };
}

function createHttpProxyServer() {
  const requests = [];
  const server = http.createServer((clientReq, clientRes) => {
    const targetUrl = new URL(clientReq.url);
    requests.push({ method: clientReq.method, url: clientReq.url });

    const proxyReq = http.request({
      hostname: targetUrl.hostname,
      port: targetUrl.port,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      method: clientReq.method,
      headers: {
        ...clientReq.headers,
        host: targetUrl.host,
        'x-through-proxy': 'yes'
      }
    }, (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
      proxyRes.pipe(clientRes);
    });

    proxyReq.on('error', (error) => {
      clientRes.statusCode = 502;
      clientRes.end(JSON.stringify({ error: error.message }));
    });

    clientReq.pipe(proxyReq);
  });

  return { server, requests };
}

async function createSite(payload) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/sites',
    payload
  });

  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

test.before(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'simplehub-site-proxy-'));
  process.env.DATABASE_URL = `file:${path.join(tempDir, 'db.sqlite')}`;
  process.env.RUST_BACKTRACE = '1';
  process.env.RUST_LOG = 'info';
  process.env.PRISMA_HIDE_UPDATE_MESSAGE = '1';
  const prismaCommand = path.join(
    serverRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'prisma.cmd' : 'prisma'
  );

  execFileSync(prismaCommand, ['db', 'push', '--force-reset', '--skip-generate'], {
    cwd: serverRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  ({ buildServer } = require('../src/server'));
  ({ prisma } = require('../src/db'));
  app = await buildServer();
});

test.after(async () => {
  if (app) await app.close();
  if (prisma) await prisma.$disconnect();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test.afterEach(async () => {
  await prisma.modelDiff.deleteMany();
  await prisma.modelSnapshot.deleteMany();
  await prisma.site.deleteMany();
  await prisma.category.deleteMany();
});

test('site-http validates proxy URLs and attaches proxy agents', async () => {
  assert.equal(parseProxyUrl('socks5://user:pass@127.0.0.1:1080').protocol, 'socks5:');
  assert.throws(() => parseProxyUrl('ftp://127.0.0.1:21'), /代理协议/);

  const directOptions = buildSiteFetchOptions({ proxyUrl: null }, { method: 'GET' });
  assert.equal(directOptions.agent, undefined);

  let receivedOptions;
  await siteFetch(
    { proxyUrl: 'http://127.0.0.1:7890' },
    'http://example.com',
    { method: 'GET' },
    {
      fetchImpl: async (url, options) => {
        receivedOptions = options;
        return { ok: true };
      }
    }
  );

  assert.equal(typeof receivedOptions.agent, 'function');
  assert.equal(receivedOptions.method, 'GET');
});

test('site CRUD persists encrypted proxyUrl and allows clearing it', async () => {
  const created = await createSite({
    name: 'proxy-site',
    baseUrl: 'http://127.0.0.1:18080',
    apiKey: 'sk-test',
    apiType: 'other',
    proxyUrl: 'http://user:pass@127.0.0.1:18888'
  });

  const savedSite = await prisma.site.findUnique({ where: { id: created.id } });
  assert.ok(savedSite.proxyUrlEnc);
  assert.notEqual(savedSite.proxyUrlEnc, 'http://user:pass@127.0.0.1:18888');

  const detailResponse = await app.inject({
    method: 'GET',
    url: `/api/sites/${created.id}`
  });

  assert.equal(detailResponse.statusCode, 200, detailResponse.body);
  assert.equal(detailResponse.json().proxyUrl, 'http://user:pass@127.0.0.1:18888');

  const clearedResponse = await app.inject({
    method: 'PATCH',
    url: `/api/sites/${created.id}`,
    payload: { proxyUrl: '' }
  });

  assert.equal(clearedResponse.statusCode, 200, clearedResponse.body);

  const clearedSite = await prisma.site.findUnique({ where: { id: created.id } });
  assert.equal(clearedSite.proxyUrlEnc, null);

  const invalidResponse = await app.inject({
    method: 'POST',
    url: '/api/sites',
    payload: {
      name: 'invalid-proxy',
      baseUrl: 'http://127.0.0.1:18080',
      apiKey: 'sk-test',
      proxyUrl: 'ftp://127.0.0.1:21'
    }
  });

  assert.equal(invalidResponse.statusCode, 400, invalidResponse.body);
  assert.match(invalidResponse.body, /代理协议/);
});

test('site checks and token proxy routes honor per-site proxy settings', async () => {
  const upstream = createUpstreamServer();
  const proxy = createHttpProxyServer();
  const upstreamPort = await listen(upstream.server);
  const proxyPort = await listen(proxy.server);

  try {
    const proxiedSite = await createSite({
      name: 'proxied-site',
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      apiKey: 'sk-proxy',
      apiType: 'other',
      proxyUrl: `http://127.0.0.1:${proxyPort}`
    });

    const proxiedCheckResponse = await app.inject({
      method: 'POST',
      url: `/api/sites/${proxiedSite.id}/check?skipNotification=true`
    });

    assert.equal(proxiedCheckResponse.statusCode, 200, proxiedCheckResponse.body);
    assert.equal(proxiedCheckResponse.json().ok, true);
    assert.ok(proxy.requests.some((request) => request.url.includes('/v1/models')));
    assert.ok(upstream.requests.some((request) => request.path === '/v1/models' && request.viaProxy));

    const proxiedTokensResponse = await app.inject({
      method: 'GET',
      url: `/api/sites/${proxiedSite.id}/tokens`
    });

    assert.equal(proxiedTokensResponse.statusCode, 200, proxiedTokensResponse.body);
    assert.ok(upstream.requests.some((request) => request.path === '/api/token/' && request.viaProxy));

    const proxyRequestCount = proxy.requests.length;

    const directSite = await createSite({
      name: 'direct-site',
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      apiKey: 'sk-direct',
      apiType: 'other'
    });

    const directCheckResponse = await app.inject({
      method: 'POST',
      url: `/api/sites/${directSite.id}/check?skipNotification=true`
    });

    assert.equal(directCheckResponse.statusCode, 200, directCheckResponse.body);
    assert.equal(proxy.requests.length, proxyRequestCount);
    assert.ok(upstream.requests.some((request) => request.path === '/v1/models' && !request.viaProxy));
  } finally {
    await Promise.all([
      new Promise((resolve) => proxy.server.close(resolve)),
      new Promise((resolve) => upstream.server.close(resolve))
    ]);
  }
});

test('newapi site check solves BunkerWeb challenge through per-site proxy', async () => {
  const upstream = createBunkerWebProtectedServer();
  const proxy = createHttpProxyServer();
  const upstreamPort = await listen(upstream.server);
  const proxyPort = await listen(proxy.server);

  try {
    const protectedSite = await createSite({
      name: 'protected-newapi-site',
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      apiKey: 'sk-newapi',
      apiType: 'newapi',
      userId: '15875',
      proxyUrl: `http://127.0.0.1:${proxyPort}`
    });

    const checkResponse = await app.inject({
      method: 'POST',
      url: `/api/sites/${protectedSite.id}/check?skipNotification=true`
    });

    assert.equal(checkResponse.statusCode, 200, checkResponse.body);
    assert.equal(checkResponse.json().ok, true);
    assert.ok(proxy.requests.some((request) => request.url.includes('/challenge')));
    assert.ok(upstream.requests.filter((request) => request.path === '/challenge' && request.viaProxy).length >= 2);
    assert.ok(upstream.requests.some((request) => request.path === '/api/user/models' && request.viaProxy));
    assert.ok(upstream.requests.some((request) => request.path === '/api/user/self' && request.viaProxy));
    assert.ok(upstream.requests.some((request) => request.path === '/challenge' && request.method === 'POST' && /challenge=688/.test(request.body)));
  } finally {
    await Promise.all([
      new Promise((resolve) => proxy.server.close(resolve)),
      new Promise((resolve) => upstream.server.close(resolve))
    ]);
  }
});

test('site export and import preserve categories', async () => {
  const category = await prisma.category.create({
    data: {
      name: '已分类站点',
      scheduleCron: null,
      timezone: 'Asia/Shanghai'
    }
  });

  const createdSite = await createSite({
    name: 'categorized-site',
    baseUrl: 'http://127.0.0.1:18080',
    apiKey: 'sk-export-test',
    apiType: 'other',
    categoryId: category.id
  });

  const exportResponse = await app.inject({
    method: 'GET',
    url: '/api/exports/sites'
  });

  assert.equal(exportResponse.statusCode, 200, exportResponse.body);
  const exportedData = exportResponse.json();

  assert.equal(exportedData.version, '1.2');
  assert.ok(Array.isArray(exportedData.categories));
  assert.equal(exportedData.categories.length, 1);
  assert.deepEqual(exportedData.categories[0], {
    name: '已分类站点',
    scheduleCron: null,
    timezone: 'Asia/Shanghai'
  });
  assert.equal(exportedData.sites.length, 1);
  assert.equal(exportedData.sites[0].name, createdSite.name);
  assert.equal(exportedData.sites[0].categoryName, '已分类站点');
  assert.equal('categoryId' in exportedData.sites[0], false);

  await prisma.site.deleteMany();
  await prisma.category.deleteMany();

  const importResponse = await app.inject({
    method: 'POST',
    url: '/api/sites/import',
    payload: exportedData
  });

  assert.equal(importResponse.statusCode, 200, importResponse.body);
  assert.equal(importResponse.json().imported, 1);
  assert.equal(importResponse.json().errors, undefined);

  const restoredCategory = await prisma.category.findUnique({
    where: { name: '已分类站点' }
  });
  assert.ok(restoredCategory);
  assert.equal(restoredCategory.scheduleCron, null);
  assert.equal(restoredCategory.timezone, 'Asia/Shanghai');

  const restoredSite = await prisma.site.findFirst({
    where: { name: 'categorized-site' },
    include: { category: true }
  });
  assert.ok(restoredSite);
  assert.equal(restoredSite.categoryId, restoredCategory.id);
  assert.equal(restoredSite.category?.name, '已分类站点');
});

test('generic token routes normalize sk prefix for display and strip it on update', async () => {
  const upstream = createUpstreamServer();
  const upstreamPort = await listen(upstream.server);

  try {
    const site = await createSite({
      name: 'generic-token-site',
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      apiKey: 'sk-generic-admin',
      apiType: 'other'
    });

    const tokensResponse = await app.inject({
      method: 'GET',
      url: `/api/sites/${site.id}/tokens`
    });

    assert.equal(tokensResponse.statusCode, 200, tokensResponse.body);
    assert.equal(tokensResponse.json().success, true);
    assert.equal(tokensResponse.json().data[0].key, 'sk-tok-1');

    const updateResponse = await app.inject({
      method: 'PUT',
      url: `/api/sites/${site.id}/tokens`,
      payload: {
        id: 1,
        name: 'token-1',
        key: 'sk-tok-1',
        group: '',
        expired_time: -1,
        unlimited_quota: false,
        remain_quota: 1000,
        model_limits_enabled: false,
        model_limits: '',
        allow_ips: ''
      }
    });

    assert.equal(updateResponse.statusCode, 200, updateResponse.body);
    assert.equal(updateResponse.json().success, true);

    const listRequest = upstream.requests.find((request) => request.path === '/api/token/' && request.method === 'GET');
    assert.equal(listRequest.authorization, 'Bearer sk-generic-admin');

    const updateRequest = upstream.requests.find((request) => request.path === '/api/token/' && request.method === 'PUT');
    assert.equal(updateRequest.authorization, 'Bearer sk-generic-admin');
    assert.equal(updateRequest.body.key, 'tok-1');
  } finally {
    await new Promise((resolve) => upstream.server.close(resolve));
  }
});

test('newapi token key route fetches full key and keeps user header', async () => {
  const upstream = createUpstreamServer();
  const upstreamPort = await listen(upstream.server);

  try {
    const site = await createSite({
      name: 'newapi-token-site',
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      apiKey: 'sk-newapi-admin',
      apiType: 'newapi',
      userId: '226'
    });

    const keyResponse = await app.inject({
      method: 'POST',
      url: `/api/sites/${site.id}/tokens/1/key`
    });

    assert.equal(keyResponse.statusCode, 200, keyResponse.body);
    assert.equal(keyResponse.json().success, true);
    assert.equal(keyResponse.json().data.key, 'sk-full-token-key');

    const keyRequest = upstream.requests.find((request) => request.path === '/api/token/1/key' && request.method === 'POST');
    assert.equal(keyRequest.authorization, 'Bearer sk-newapi-admin');
    assert.equal(keyRequest.newApiUser, '226');
    assert.equal(keyRequest.accept, 'application/json, text/plain, */*');
    assert.equal(keyRequest.origin, `http://127.0.0.1:${upstreamPort}`);
    assert.equal(keyRequest.referer, `http://127.0.0.1:${upstreamPort}/console/token`);
    assert.equal(keyRequest.contentLength, '0');
  } finally {
    await new Promise((resolve) => upstream.server.close(resolve));
  }
});

test('voapi token routes normalize sk prefix for display and strip it on update', async () => {
  const upstream = createVoapiTokenServer();
  const upstreamPort = await listen(upstream.server);

  try {
    const site = await createSite({
      name: 'voapi-site',
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      apiKey: 'sk-voapi-models',
      apiType: 'voapi'
    });

    const tokensResponse = await app.inject({
      method: 'GET',
      url: `/api/sites/${site.id}/tokens`
    });

    assert.equal(tokensResponse.statusCode, 200, tokensResponse.body);
    assert.equal(tokensResponse.json().success, true);
    assert.equal(
      tokensResponse.json().data[0].key,
      'sk-60Wy9oMtcZGCk1jXja0IH8PzqUgvS9moQASE7iM3CjNU6WSt'
    );

    const updateResponse = await app.inject({
      method: 'PUT',
      url: `/api/sites/${site.id}/tokens`,
      payload: {
        id: 1,
        name: 'voapi-token',
        group: '2',
        expired_time: -1,
        unlimited_quota: false,
        remain_quota: 500000,
        key: 'sk-60Wy9oMtcZGCk1jXja0IH8PzqUgvS9moQASE7iM3CjNU6WSt',
        uid: 8,
        used_quota: 125000
      }
    });

    assert.equal(updateResponse.statusCode, 200, updateResponse.body);
    assert.equal(updateResponse.json().success, true);

    const createResponse = await app.inject({
      method: 'POST',
      url: `/api/sites/${site.id}/tokens`,
      payload: {
        name: 'new-token',
        remainQuota: 500000,
        unlimitedQuota: false,
        expiredTime: -1,
        groups: [2]
      }
    });

    assert.equal(createResponse.statusCode, 200, createResponse.body);
    assert.equal(createResponse.json().success, true);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/sites/${site.id}/tokens/1`
    });

    assert.equal(deleteResponse.statusCode, 200, deleteResponse.body);
    assert.equal(deleteResponse.json().success, true);

    const listRequest = upstream.requests.find((request) => request.path === '/api/keys' && request.method === 'GET');
    assert.equal(listRequest.authorization, 'sk-voapi-models');

    const createRequest = upstream.requests.find((request) => request.path === '/api/keys' && request.method === 'POST');
    assert.equal(createRequest.authorization, 'sk-voapi-models');

    const updateRequest = upstream.requests.find((request) => request.path === '/api/keys/1' && request.method === 'PUT');
    assert.equal(updateRequest.authorization, 'sk-voapi-models');
    assert.equal(updateRequest.body.token, '60Wy9oMtcZGCk1jXja0IH8PzqUgvS9moQASE7iM3CjNU6WSt');

    const deleteRequest = upstream.requests.find((request) => request.path === '/api/keys/1' && request.method === 'DELETE');
    assert.equal(deleteRequest.authorization, 'sk-voapi-models');
  } finally {
    await new Promise((resolve) => upstream.server.close(resolve));
  }
});

test('voapi site check, billing, pricing and check-in all use raw apiKey authorization', async () => {
  const upstream = createVoapiAccessServer();
  const upstreamPort = await listen(upstream.server);

  try {
    const site = await createSite({
      name: 'voapi-access-site',
      baseUrl: `http://127.0.0.1:${upstreamPort}`,
      apiKey: 'voapi-access-token',
      apiType: 'voapi',
      enableCheckIn: true,
      checkInMode: 'both',
      unlimitedQuota: false
    });

    const checkResponse = await app.inject({
      method: 'POST',
      url: `/api/sites/${site.id}/check?skipNotification=true`
    });

    assert.equal(checkResponse.statusCode, 200, checkResponse.body);
    assert.equal(checkResponse.json().ok, true);
    assert.equal(checkResponse.json().checkInResult.checkInSuccess, true);
    assert.equal(checkResponse.json().checkInResult.checkInMessage, '签到成功');
    assert.equal(checkResponse.json().checkInResult.checkInQuota, 2.85);

    const pricingResponse = await app.inject({
      method: 'GET',
      url: `/api/sites/${site.id}/pricing`
    });

    assert.equal(pricingResponse.statusCode, 200, pricingResponse.body);
    assert.equal(pricingResponse.json().code, 0);

    const modelsRequests = upstream.requests.filter((request) => request.path === '/api/models' && request.method === 'GET');
    assert.ok(modelsRequests.length >= 2);
    assert.ok(modelsRequests.every((request) => request.authorization === 'voapi-access-token'));

    const checkInRequest = upstream.requests.find((request) => request.path === '/api/check_in' && request.method === 'POST');
    assert.equal(checkInRequest.authorization, 'voapi-access-token');

    const userInfoRequest = upstream.requests.find((request) => request.path === '/api/user/info' && request.method === 'GET');
    assert.equal(userInfoRequest.authorization, 'voapi-access-token');
  } finally {
    await new Promise((resolve) => upstream.server.close(resolve));
  }
});
