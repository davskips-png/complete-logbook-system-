const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const SECURITY_FILE = path.join(__dirname, 'server-security.json');
const PUBLIC_ROOT = path.resolve(__dirname);
const MAX_BODY_BYTES = 45 * 1024 * 1024;
const AUTH_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const configuredPassword = process.env.ADMIN_PASSWORD || '';
const isProduction = process.env.NODE_ENV === 'production';
// Development fallback keeps the local demo usable. Production must provide a secret.
const AUTH_PASSWORD = configuredPassword || (!isProduction ? 'SpectrumDemo2025!Auth' : '');
if (!AUTH_PASSWORD || AUTH_PASSWORD.length < 12) {
  throw new Error('ADMIN_PASSWORD must be set and contain at least 12 characters in production.');
}
const AUTH_PASSWORD_HASH = crypto.scryptSync(
  AUTH_PASSWORD,
  process.env.AUTH_SALT || 'spectrum-auth-salt',
  64
).toString('hex');
const AUTH_SALT = process.env.AUTH_SALT || 'spectrum-auth-salt';
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 60;

const DEFAULT_SECURITY = {
  sessionTimeout: 30,
  ipWhitelist: [],
  mfa: 'OPTIONAL',
  auditLogging: 'ENABLED'
};

const sessions = new Map();
const rateBuckets = new Map();

const PUBLIC_FILES = new Set([
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/calculator.js',
  'js/data.js',
  'js/engine.js',
  'js/ledger.js',
  'js/lms.js',
  'js/los.js',
  'js/buyoff-offer-letter.js'
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function readSecurity() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SECURITY_FILE, 'utf8'));
    return validateSecurity({ ...DEFAULT_SECURITY, ...parsed });
  } catch (_) {
    return { ...DEFAULT_SECURITY };
  }
}

function validIPv4(value) {
  const parts = String(value).split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function validCIDR(value) {
  const parts = String(value).split('/');
  return parts.length === 2 && validIPv4(parts[0]) && /^\d{1,2}$/.test(parts[1]) && Number(parts[1]) <= 32;
}

function validateSecurity(config) {
  const sessionTimeout = Number(config.sessionTimeout);
  const whitelist = Array.isArray(config.ipWhitelist) ? config.ipWhitelist.map(String) : [];
  if (!Number.isInteger(sessionTimeout) || sessionTimeout < 5 || sessionTimeout > 480) {
    throw new Error('sessionTimeout must be between 5 and 480 minutes');
  }
  if (whitelist.length > 100 || whitelist.some(value => !validIPv4(value) && !validCIDR(value))) {
    throw new Error('ipWhitelist contains an invalid address or range');
  }
  if (!['OPTIONAL', 'REQUIRED'].includes(config.mfa)) throw new Error('Invalid MFA setting');
  if (!['ENABLED', 'DISABLED'].includes(config.auditLogging)) throw new Error('Invalid audit setting');
  return { sessionTimeout, ipWhitelist: whitelist, mfa: config.mfa, auditLogging: config.auditLogging };
}

function writeSecurity(config) {
  const safe = validateSecurity({ ...DEFAULT_SECURITY, ...config });
  const temp = `${SECURITY_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(safe, null, 2), { mode: 0o600 });
  fs.renameSync(temp, SECURITY_FILE);
}

function clientIp(req) {
  // Forwarded headers are intentionally ignored unless a trusted proxy is added here.
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '::1' ? '127.0.0.1' : ip;
}

function ipv4ToNumber(value) {
  if (!validIPv4(value)) return null;
  return value.split('.').reduce((total, part) => total * 256 + Number(part), 0) >>> 0;
}

function ipAllowed(ip, whitelist) {
  if (!whitelist.length) return true;
  const address = ipv4ToNumber(ip);
  if (address === null) return false;
  return whitelist.some(entry => {
    if (entry.includes('/')) {
      const [network, prefixText] = entry.split('/');
      const prefix = Number(prefixText);
      const networkNumber = ipv4ToNumber(network);
      if (networkNumber === null || prefix === 0) return prefix === 0;
      const mask = (0xffffffff << (32 - prefix)) >>> 0;
      return (address & mask) === (networkNumber & mask);
    }
    return address === ipv4ToNumber(entry);
  });
}

function parseCookies(req) {
  return String(req.headers.cookie || '').split(';').reduce((cookies, item) => {
    const [key, ...parts] = item.trim().split('=');
    if (!key) return cookies;
    try { cookies[key] = decodeURIComponent(parts.join('=')); } catch (_) {}
    return cookies;
  }, {});
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    // Existing inline handlers require unsafe-inline for now; remove it after migrating handlers to addEventListener.
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob:; font-src 'self' https://cdn.jsdelivr.net; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { ...securityHeaders(), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(Object.assign(new Error('Request body too large'), { code: 'LIMIT' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooLarge) return;
      try { resolve(body ? JSON.parse(body) : {}); } catch (_) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function allowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol)
      && parsed.host === req.headers.host
      && parsed.origin === origin;
  } catch (_) {
    return false;
  }
}

function rateLimited(ip) {
  const now = Date.now();
  const bucket = rateBuckets.get(ip) || { start: now, count: 0 };
  if (now - bucket.start >= RATE_WINDOW_MS) {
    bucket.start = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  return bucket.count > RATE_LIMIT;
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    lastSeen: Date.now(),
    createdAt: Date.now(),
    userId: user.id,
    username: user.username,
    role: user.role,
    branch: user.branch || null
  });
  return token;
}

function safeEqualText(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function authenticate(username, password) {
  // Production must provide ADMIN_PASSWORD or a database-backed user store.
  if (!AUTH_PASSWORD_HASH) return null;
  const suppliedHash = crypto.scryptSync(String(password || ''), AUTH_SALT, 64).toString('hex');
  if (String(username || '') !== AUTH_USERNAME || !safeEqualText(suppliedHash, AUTH_PASSWORD_HASH)) return null;
  return { id: 'configured-admin', username: AUTH_USERNAME, role: 'SUPER_ADMIN', branch: null };
}

function requireSession(req, res) {
  const token = parseCookies(req).spectrum_session;
  const session = token && sessions.get(token);
  const timeout = readSecurity().sessionTimeout * 60 * 1000;
  if (!session || Date.now() - session.lastSeen > timeout) {
    if (token) sessions.delete(token);
    sendJson(res, 401, { ok: false, error: 'Authentication session expired or missing.' });
    return null;
  }
  session.lastSeen = Date.now();
  return session;
}

function servePublic(req, res, reqPath) {
  let decoded;
  try { decoded = decodeURIComponent(reqPath); } catch (_) { res.writeHead(400, securityHeaders()); return res.end('Bad request'); }
  const relative = decoded.replace(/^\/+/, '');
  if (!PUBLIC_FILES.has(relative)) {
    res.writeHead(404, securityHeaders());
    return res.end('404 Not Found');
  }
  const filePath = path.resolve(PUBLIC_ROOT, relative);
  if (!filePath.startsWith(PUBLIC_ROOT + path.sep)) {
    res.writeHead(403, securityHeaders());
    return res.end('Forbidden');
  }
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, securityHeaders());
      return res.end('404 Not Found');
    }
    res.writeHead(200, { ...securityHeaders(), 'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  res.setTimeout(15_000, () => { res.destroy(); });
  const reqPath = String(req.url || '/').split('?')[0];
  const ip = clientIp(req);

  if (rateLimited(ip)) return sendJson(res, 429, { ok: false, error: 'Too many requests. Try again later.' }, { 'Retry-After': '60' });
  if (!allowedOrigin(req)) return sendJson(res, 403, { ok: false, error: 'Origin is not allowed.' });

  if (reqPath.startsWith('/api/')) {
    const security = readSecurity();
    if (!ipAllowed(ip, security.ipWhitelist)) return sendJson(res, 403, { ok: false, error: 'Request blocked by IP whitelist policy.' });
    if (reqPath === '/api/auth/session' && req.method === 'POST') {
      let body;
      try {
        body = await readBody(req);
      } catch (error) {
        return sendJson(res, error.code === 'LIMIT' ? 413 : 400, { ok: false, error: error.message });
      }
      const user = authenticate(body.username, body.password);
      if (!user) {
        return sendJson(res, 401, { ok: false, error: 'Invalid username or password.' });
      }
      const token = createSession(user);
      const secureCookie = isProduction ? '; Secure' : '';
      return sendJson(res, 200, {
        ok: true,
        authenticated: true,
        user: { id: user.id, username: user.username, role: user.role, branch: user.branch },
        sessionTimeout: security.sessionTimeout
      }, {
        'Set-Cookie': `spectrum_session=${token}; HttpOnly${secureCookie}; SameSite=Strict; Path=/; Max-Age=${security.sessionTimeout * 60}`
      });
    }
    if (reqPath === '/api/auth/logout' && req.method === 'POST') {
      const token = parseCookies(req).spectrum_session;
      if (token) sessions.delete(token);
      const secureCookie = isProduction ? '; Secure' : '';
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': `spectrum_session=; HttpOnly${secureCookie}; SameSite=Strict; Path=/; Max-Age=0` });
    }
    if (reqPath === '/api/auth/me' && req.method === 'GET') {
      const session = requireSession(req, res);
      if (!session) return;
      return sendJson(res, 200, {
        ok: true,
        authenticated: true,
        user: { id: session.userId, username: session.username, role: session.role, branch: session.branch }
      });
    }
    if (reqPath === '/api/security/status' && req.method === 'GET') {
      const session = requireSession(req, res);
      if (!session) return;
      return sendJson(res, 200, { ok: true, authenticated: true, role: session.role, ipWhitelisting: security.ipWhitelist.length > 0, sessionTimeout: security.sessionTimeout, mfa: security.mfa, auditLogging: security.auditLogging });
    }
    if (reqPath === '/api/security/config' && req.method === 'POST') {
      const session = requireSession(req, res);
      if (!session) return;
      if (session.role !== 'SUPER_ADMIN') return sendJson(res, 403, { ok: false, error: 'Only an authenticated Super Admin can update security configuration.' });
      let body;
      try { body = await readBody(req); validateSecurity(body); } catch (error) {
        return sendJson(res, error.code === 'LIMIT' ? 413 : 400, { ok: false, error: error.message });
      }
      try { writeSecurity(body); } catch (error) { return sendJson(res, 400, { ok: false, error: error.message }); }
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { ok: false, error: 'API endpoint not found.' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, securityHeaders());
    return res.end('Method Not Allowed');
  }
  if (reqPath === '/login.html' || reqPath === '/forgot-password.html') {
    const destination = reqPath === '/forgot-password.html' ? '/index.html?view=forgot' : '/index.html';
    res.writeHead(302, { ...securityHeaders(), Location: destination, 'Cache-Control': 'no-store' });
    return res.end();
  }
  servePublic(req, res, reqPath === '/' ? '/index.html' : reqPath);
});

setInterval(() => {
  const cutoff = Date.now() - readSecurity().sessionTimeout * 60 * 1000;
  for (const [token, session] of sessions) if (session.lastSeen < cutoff) sessions.delete(token);
  for (const [ip, bucket] of rateBuckets) if (Date.now() - bucket.start > RATE_WINDOW_MS * 2) rateBuckets.delete(ip);
}, 60_000).unref();

server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.listen(PORT, () => console.log(`Secure LMS & LOS server listening on port ${PORT}`));
