# DH Voice Platform — Netlify deployment

This package preserves the uploaded React/Vite user interface and its existing
login, voice profiles, history, pronunciation dictionary and generation flows.
The existing `DH-TTS` GitHub repository may keep its original documentation at
root; add the `frontend/` folder and the root `netlify.toml` from this package.

## Netlify steps

1. Commit `frontend/` and `netlify.toml` to the existing GitHub repository.
2. Netlify > Add new project > Import existing project > GitHub > DH-TTS.
3. The root `netlify.toml` sets base=`frontend`, build=`npm run build`, publish=`dist`.
4. Set environment variable `VITE_API_URL=https://YOUR-API-HOST` (no trailing slash).
5. Redeploy. The URL is baked into the static build.

**Important:** Netlify hosts the interface only. The existing login, PostgreSQL
queue, uploaded reference-voice files, speech history and authenticated WAV
responses need a separately hosted, persistent FastAPI + PostgreSQL service.
That service is NOT supplied by Netlify static hosting or Kaggle GPU sessions.

## Security and behavior

- Reference voice and model weights MUST NOT be committed to this public repo.
- Audio playback now uses Bearer-authenticated `/api/generations/<id>/audio`
  rather than the original publicly exposed `/media` directory.
- `VITE_API_URL` is a public configuration value. Never store secrets in Vite
  variables; they are visible to every visitor in bundled JavaScript.
- Login uses the original app JWT scheme. Public production deployment requires
  strong passwords, HTTPS, rate-limiting, and a careful security review.
- If the Kaggle session is offline, generation jobs may remain pending; the UI
  stays online but cannot synthesize speech.

For private backend + Kaggle worker integration, see the separate *PRIVATE*
backend package. Avoid uploading its `.env` or voice recordings to GitHub.
