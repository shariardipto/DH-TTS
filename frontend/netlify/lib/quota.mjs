import { createHmac } from 'node:crypto'

// Atomic Redis Lua gate; increments all three counters together or none.
// Daily UTC quotas are an upper bound on requests, NOT a measurement of GPU seconds.
export const DAILY_IP_LIMIT = 3
export const DAILY_SITE_LIMIT = 10
export const COOLDOWN_SECONDS = 120

const SCRIPT = `
local ip = tonumber(redis.call('GET', KEYS[1]) or '0')
local site = tonumber(redis.call('GET', KEYS[2]) or '0')
local last = tonumber(redis.call('GET', KEYS[3]) or '0')
local now = tonumber(ARGV[1])
if ip >= tonumber(ARGV[2]) then return {0, 'ip_daily'} end
if site >= tonumber(ARGV[3]) then return {0, 'site_daily'} end
if now - last < tonumber(ARGV[4]) then return {0, 'cooldown'} end
redis.call('INCR', KEYS[1])
redis.call('INCR', KEYS[2])
redis.call('SET', KEYS[3], now, 'EX', tonumber(ARGV[4]))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[5]))
return {1, 'ok'}
`

export async function consumeQuota(req, options = {}) {
  const env = options.env || process.env
  const fetcher = options.fetcher || fetch
  const endpoint = env.UPSTASH_REDIS_REST_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN
  const secret = env.DH_RATE_SALT
  const ip = req.headers.get('x-nf-client-connection-ip')
  // Never accept x-forwarded-for, which visitors can manipulate.
  if (!endpoint || !token || !secret || secret.length < 32 || !ip) {
    throw new Error('Quota protection is not configured. Requests are blocked.')
  }
  const url = new URL(endpoint)
  if (url.protocol !== 'https:') throw new Error('Redis endpoint must use HTTPS.')
  const now = Math.floor(Date.now() / 1000)
  const date = new Date(now * 1000).toISOString().slice(0, 10)
  const ipId = createHmac('sha256', secret).update(ip).digest('hex')
  const keys = [
    `dh-tts:{public}:ip:${date}:${ipId}`,
    `dh-tts:{public}:site:${date}`,
    `dh-tts:{public}:cooldown:${ipId}`,
  ]
  const secondsToTomorrow = 86400 - (now % 86400)
  const payload = ['EVAL', SCRIPT, '3', ...keys,
    String(now), String(DAILY_IP_LIMIT), String(DAILY_SITE_LIMIT),
    String(COOLDOWN_SECONDS), String(secondsToTomorrow + 3600)]
  const reply = await fetcher(endpoint, {
    method:'POST',
    headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json'},
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  })
  if (!reply.ok) throw new Error('Rate limit service unavailable.')
  const body = await reply.json()
  if (body.error || !Array.isArray(body.result) || ![0,1].includes(Number(body.result[0]))) {
    throw new Error('Invalid rate limit service response.')
  }
  const allowed = Number(body.result[0]) === 1
  return { allowed, reason: String(body.result[1]) }
}
