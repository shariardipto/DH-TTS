import { json, authorized, validPassword, issueCookie, clearCookie, sameOrigin, settingsOK } from '../lib/session.mjs'

export default async function handler(req) {
  if (!settingsOK()) return json({error:'Netlify demo access variables are missing or too short.'},503)
  if (req.method==='GET') return json({authenticated:authorized(req)})
  if (req.method==='POST') {
    if (!sameOrigin(req)) return json({error:'Invalid request origin.'},403)
    let input
    try { input = await req.json() } catch { return json({error:'Invalid JSON.'},400) }
    if (!validPassword(input?.password)) return json({error:'Incorrect demo password.'},401)
    return json({authenticated:true},200,{'Set-Cookie':issueCookie()})
  }
  if (req.method==='DELETE') {
    if (!sameOrigin(req)) return json({error:'Invalid request origin.'},403)
    return json({authenticated:false},200,{'Set-Cookie':clearCookie()})
  }
  return json({error:'Method not allowed.'},405)
}
