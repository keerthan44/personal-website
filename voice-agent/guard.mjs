const DEFAULT_ORIGINS = 'https://www.itskeerthan.com,https://itskeerthan.com';

export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  const first = Array.isArray(xff) ? xff[0] : xff;
  if (first) {
    const ip = String(first).split(',')[0].trim();
    if (ip) return ip;
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

export function originAllowed(env, origin) {
  if (!origin) return false;
  const allowed = (env.VOICE_ALLOWED_ORIGINS || DEFAULT_ORIGINS)
    .split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.includes(origin)) return true;
  if (env.NODE_ENV !== 'production') {
    return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  }
  return false;
}
