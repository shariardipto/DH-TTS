import { createHmac, createHash, timingSafeEqual } from 'node:crypto'

const COOKIE_NAME = '__Host-dh_tts_session'
const SESSION_HOURS = 8

export function json(data, status = 200, headers = {}) {
  return Response.json(data, {status, headers: {
    'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers
  }})
}

export function settingsOK() {
  return (process.env.DH_DEMO_PASSWORD || '').length >= 16 &&
    (process.env.DH_DEMO_SESSION_SECRET || '').length >= 32
}

function equal(a,b) {
  const ah=createHash('sha256').update(a).digest()
  const bh=createHash('sha256').update(b).digest()
  return timingSafeEqual(ah,bh)
}

function signature(data) {
  return createHmac('sha256', process.env.DH_DEMO_SESSION_SECRET).update(data).digest('base64url')
}

export function validPassword(candidate) {
  return settingsOK() && typeof candidate === 'string' && equal(candidate,process.env.DH_DEMO_PASSWORD)
}

export function issueCookie() {
  const exp = Date.now()+SESSION_HOURS*3600*1000
  const payload=`v1.${exp}`
  const value = `${payload}.${signature(payload)}`
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS*3600}`
}

export function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
}

export function authorized(req) {
  if (!settingsOK()) return false
  const raw = req.headers.get('cookie') || ''
  const item=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE_NAME+'='))
  if (!item) return false
  const value=item.slice(COOKIE_NAME.length+1)
  const match=/^(v1\.([0-9]{13}))\.([A-Za-z0-9_-]{43})$/.exec(value)
  if (!match) return false
  const exp=Number(match[2])
  return exp>Date.now() && exp<Date.now()+SESSION_HOURS*3600*1000 && equal(match[3],signature(match[1]))
}

export function sameOrigin(req) {
  const origin=req.headers.get('origin')
  if (!origin) return false
  try { return new URL(origin).origin===new URL(req.url).origin } catch { return false }
}
