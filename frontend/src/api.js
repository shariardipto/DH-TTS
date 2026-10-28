// This URL is public configuration, never a secret or HF access token.
const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

export function getToken() {
  return localStorage.getItem('dh_voice_token') || ''
}

export function setToken(token) {
  localStorage.setItem('dh_voice_token', token)
}

export function clearToken() {
  localStorage.removeItem('dh_voice_token')
}

function apiUrl(path) {
  if (!API_BASE && import.meta.env.PROD) {
    throw new Error('Backend API is not configured. Set VITE_API_URL in Netlify and redeploy.')
  }
  return `${API_BASE}${path}`
}

async function authorizedFetch(path, options = {}) {
  const headers = new Headers(options.headers || {})
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  let res
  try {
    res = await fetch(apiUrl(path), { ...options, headers })
  } catch (error) {
    throw new Error(`Unable to reach the DH TTS API. ${error.message}`)
  }
  if (res.status === 401) {
    clearToken()
    window.dispatchEvent(new Event('dh-auth-expired'))
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const payload = await res.json()
      if (typeof payload.detail === 'string') detail = payload.detail
    } catch { /* use status */ }
    throw new Error(detail)
  }
  return res
}

export async function api(path, options = {}) {
  const res = await authorizedFetch(path, options)
  if (res.status === 204) return null
  return res.json()
}

// Audio downloads require the same user token as all other generation endpoints.
// Never put bearer tokens in audio URLs/query parameters.
export async function getGenerationAudioBlob(generationId) {
  const res = await authorizedFetch(`/api/generations/${encodeURIComponent(generationId)}/audio`)
  return res.blob()
}
