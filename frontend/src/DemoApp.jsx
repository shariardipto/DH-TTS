import React, { useEffect, useState } from 'react'

async function requestJSON(path, options) {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options })
  let payload
  try { payload = await response.json() } catch { payload = {} }
  if (!response.ok) throw new Error(payload.error || `Request failed (HTTP ${response.status})`)
  return payload
}

const SESSION_ENDPOINT = '/.netlify/functions/hf-session'
const GENERATE_ENDPOINT = '/.netlify/functions/hf-generate'

export default function DemoApp() {
  const [checking, setChecking] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)
  const [tab, setTab] = useState('generate')
  const [text, setText] = useState('আজকের সংবাদে আপনাদের স্বাগত।')
  const [refFile, setRefFile] = useState(null)
  const [refText, setRefText] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [job, setJob] = useState(null)
  const [history, setHistory] = useState([])

  useEffect(() => {
    let active = true
    requestJSON(SESSION_ENDPOINT)
      .then(res => { if (active) setAuthenticated(!!res.authenticated) })
      .catch(err => { if (active) setError(err.message) })
      .finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [])

  async function login(event) {
    event.preventDefault()
    setLoggingIn(true); setError('')
    try {
      await requestJSON(SESSION_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      setAuthenticated(true)
      setPassword('')
    } catch (err) { setError(err.message) }
    finally { setLoggingIn(false) }
  }

  async function logout() {
    try { await requestJSON(SESSION_ENDPOINT, { method: 'DELETE' }) } catch { /* server cookie expires normally */ }
    setAuthenticated(false); setJob(null); setHistory([]); setTab('generate')
  }

  async function generate() {
    setError('')
    if (!text.trim()) return setError('বাংলা Text লিখুন।')
    if (text.length > 250) return setError('ZeroGPU Demo-তে সর্বোচ্চ ২৫০ অক্ষর ব্যবহার করুন।')
    if (!refFile) return setError('Reference WAV File নির্বাচন করুন।')
    if (!refText.trim()) return setError('Reference Audio-এর সঠিক Transcript লিখুন।')
    if (!consent) return setError('Reference Voice ব্যবহারের অনুমতি নিশ্চিত করুন।')
    if (refFile.size > 3 * 1024 * 1024) return setError('Reference WAV সর্বোচ্চ ৩ MB হতে পারবে।')
    setBusy(true); setJob({ status: 'running', text })
    const form = new FormData()
    form.append('text', text)
    form.append('ref_text', refText)
    form.append('consent', 'true')
    form.append('ref_audio', refFile)
    try {
      const result = await requestJSON(GENERATE_ENDPOINT, { method: 'POST', body: form })
      const item = { id: Date.now().toString(), status: 'completed', text, audio: `data:audio/wav;base64,${result.audio_base64}`, filename: result.filename || 'dh-tts.wav', save_status: result.save_status || 'Audio generated' }
      setJob(item)
      setHistory(old => [item, ...old].slice(0, 8))
    } catch (err) {
      if (/HTTP 401/.test(err.message) || /Session expired/i.test(err.message)) setAuthenticated(false)
      setJob({ status: 'failed', text })
      setError(err.message)
    } finally { setBusy(false) }
  }

  if (checking) return <div className="login-shell"><div className="login-card"><h2>DH Voice Platform</h2><p>Checking demo session…</p></div></div>
  if (!authenticated) return <div className="login-shell"><form className="login-card" onSubmit={login}>
    <div className="brand-mark">DH</div><h1>Dhaka Heralds</h1><p>Voice Platform · Private HF Demo</p>
    <label>Demo password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
    {error && <div className="error">{error}</div>}
    <button className="primary" disabled={loggingIn}>{loggingIn ? 'Signing in…' : 'Sign in'}</button>
    <p className="muted" style={{marginTop:16}}>Only authorized users may use the reference voice. Your Hugging Face token is never stored in the browser.</p>
  </form></div>

  return <div className="app-shell">
    <aside>
      <div className="brand"><div className="brand-mark small">DH</div><div><strong>Dhaka Heralds</strong><span>Voice Platform</span></div></div>
      <nav>{['generate','history','voices','pronunciation'].map(x => <button key={x} className={tab===x?'active':''} onClick={() => setTab(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}</nav>
      <div className="model-pill"><span className="dot"/> DH-TTS <small>v0.1 · HF ZeroGPU</small></div>
      <div className="profile"><strong>Private Demo</strong><span>Session-based access</span><button onClick={logout}>Sign out</button></div>
    </aside>
    <main>
      <header><div><h1>{tab==='generate'?'Text to Speech':tab[0].toUpperCase()+tab.slice(1)}</h1><p>Bangladesh Bangla newsroom voice generation</p></div><div className="engine">Engine <strong>DH-TTS · ZeroGPU</strong></div></header>
      {error && <div className="error banner">{error}</div>}
      {tab==='generate' && <div className="grid two">
        <section className="panel editor-panel">
          <div className="field-row"><label>Voice<input value="Authorized Reference WAV" disabled /></label><label>Mode<input value="Bangladesh Bangla" disabled /></label></div>
          <label className="hf-label">Reference WAV (max 3 MB)<input className="hf-file" type="file" accept=".wav,audio/wav" onChange={e=>setRefFile(e.target.files?.[0] || null)} /></label>
          <label className="hf-label">Reference Audio Transcript<textarea className="hf-reference-text" value={refText} onChange={e=>setRefText(e.target.value)} placeholder="Reference WAV-এ যা বলা হয়েছে, হুবহু লিখুন…" /></label>
          <label className="hf-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} /> I have permission to use this reference voice.</label>
          <label className="hf-label" htmlFor="dh-bengali-text">বাংলা Text</label>
          <textarea id="dh-bengali-text" className="hf-main-text" value={text} onChange={e=>setText(e.target.value)} placeholder="এখানে বাংলা নিউজ স্ক্রিপ্ট লিখুন..." />
          <div className="editor-footer"><span>{text.length.toLocaleString()} / 250 characters</span><span>ZeroGPU quota applies</span><button className="primary" disabled={busy || !text.trim() || !refFile || !refText.trim() || !consent} onClick={generate}>{busy?'Generating…':'Generate'}</button></div>
        </section>
        <section className="panel output-panel"><h2>Current generation</h2>
          {!job && <div className="empty">Generate a script to see the audio here.</div>}
          {job?.status==='running' && <div className="empty">Hugging Face ZeroGPU is generating your Bengali audio…</div>}
          {job?.status==='completed' && <div className="hf-result"><span className="status completed">Completed</span><audio controls src={job.audio} preload="none"/><a className="button ghost" href={job.audio} download={job.filename}>Download WAV</a><p className="muted">{job.save_status}</p></div>}
          {job?.status==='failed' && <div className="error">Generation failed. See the error message above.</div>}
        </section>
      </div>}
      {tab==='history' && <section className="panel"><h2>Generation history (this tab only)</h2><p className="muted">Saved WAVs persist in your private HF Bucket. This list resets when you refresh the page; permanent account history needs a separate backend.</p>
        <div className="history-list">{history.length ? history.map(item => <div className="history-card" key={item.id}><div className="history-top"><strong>DH-TTS v0.1</strong><span className="status completed">completed</span></div><p>{item.text}</p><audio controls src={item.audio}/><a className="button ghost" href={item.audio} download={item.filename}>Download WAV</a></div>) : <div className="empty">No generations in this browser tab.</div>}</div></section>}
      {tab==='voices' && <section className="panel"><h2>Voice profiles</h2><p className="muted">For this private demo, select your authorized Reference WAV and its exact transcript on the Generate screen. Saved voice profiles need the original FastAPI + Database backend.</p></section>}
      {tab==='pronunciation' && <section className="panel"><h2>BD-BN Pronunciation Dictionary</h2><p className="muted">The persistent dictionary requires the original Backend API. This ZeroGPU demo sends your typed Bengali text directly to DH-TTS.</p></section>}
    </main>
  </div>
}
