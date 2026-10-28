export function json(data, status = 200, headers = {}) {
  return Response.json(data, {status, headers: {
    'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', ...headers
  }})
}

export function sameOrigin(req) {
  const origin = req.headers.get('origin')
  if (!origin) return false
  try {return new URL(origin).origin === new URL(req.url).origin}
  catch {return false}
}
