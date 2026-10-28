import React, { useState } from 'react'

const GENERATE_ENDPOINT = '/api/generate'
const MAX_TEXT = 250
const MAX_REF_TEXT = 1000
const MAX_WAV = 2 * 1024 * 1024

async function requestJSON(path, options) {
  const response = await fetch(path, { credentials: 'omit', cache: 'no-store', ...options })
  let payload = {}
  try { payload = await response.json() } catch { /* Netlify-native 429 may have no JSON */ }
  if (!response.ok) {
    if (response.status === 429) throw new Error(payload.error || 'Rate limit reached. Please try again later.')
    throw new Error(payload.error || `Request failed (HTTP ${response.status})`)
  }
  return payload
}

export default function DemoApp() {
  const [tab, setTab] = useState('generate')
  const [text, setText] = useState('আজকের সংবাদে আপনাদের স্বাগত।')
  const [refFile, setRefFile] = useState(null)
  const [refText, setRefText] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [job, setJob] = useState(null)
  const [history, setHistory] = useState([])

  async function generate() {
    setError('')
    if (!text.trim() || text.length > MAX_TEXT) return setError('বাংলা Text ১–২৫০ অক্ষরের মধ্যে দিন।')
    if (!refFile || refFile.size > MAX_WAV || !/\.wav$/i.test(refFile.name)) return setError('সর্বোচ্চ ২ MB-এর WAV Reference Audio দিন।')
    if (!refText.trim() || refText.length > MAX_REF_TEXT) return setError('Reference Audio-এর Transcript (সর্বোচ্চ ১০০০ অক্ষর) দিন।')
    if (!consent) return setError('Reference Voice ব্যবহারের অনুমতি নিশ্চিত করুন।')

    const form = new FormData()
    form.append('text', text.trim())
    form.append('ref_text', refText.trim())
    form.append('consent', 'true')
    form.append('ref_audio', refFile)
    setBusy(true)
    setJob({ status: 'running', text })
    try {
      const result = await requestJSON(GENERATE_ENDPOINT, { method: 'POST', body: form })
      const item = {
        id: crypto.randomUUID(), status: 'completed', text,
        audio: `data:audio/wav;base64,${result.audio_base64}`,
        filename: result.filename || 'dh-tts.wav',
        save_status: result.save_status || 'Audio generated'
      }
      setJob(item)
      setHistory(previous => [item, ...previous].slice(0, 5))
    } catch (err) {
      setJob({ status: 'failed', text })
      setError(err.message)
    } finally { setBusy(false) }
  }

  return <div className="app-shell">
    <aside>
      <div className="brand"><div className="brand-mark small">DH</div><div><strong>Dhaka Heralds</strong><span>Voice Platform</span></div></div>
      <nav>{['generate','history','voices','pronunciation'].map(x => <button key={x} className={tab===x?'active':''} onClick={() => setTab(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}</nav>
      <div className="model-pill"><span className="dot"/> DH-TTS <small>v0.1 · HF ZeroGPU</small></div>
      <div className="profile"><strong>Public Demo</strong><span>Free GPU · Limited requests</span></div>
    </aside>
    <main>
      <header><div><h1>{tab==='generate'?'Text to Speech':tab[0].toUpperCase()+tab.slice(1)}</h1><p>Bangladesh Bangla newsroom voice generation</p></div><div className="engine">Engine <strong>DH-TTS · ZeroGPU</strong></div></header>
      {error && <div className="error banner" role="alert">{error}</div>}
      {tab==='generate' && <>
        <div className="hf-public-notice">Public Demo · No password. Maximum 3 requests/IP/day and 10 requests/day across the site; minimum 2 minutes between accepted requests/IP. Subject to Hugging Face ZeroGPU availability. Only upload a voice you have permission to use.</div>
        <div className="grid two">
          <section className="panel editor-panel">
            <div className="field-row"><label>Voice<input value="Authorized Reference WAV" disabled /></label><label>Mode<input value="Bangladesh Bangla" disabled /></label></div>
            <label className="hf-label">Reference WAV (max 2 MB · max 15 seconds)<input className="hf-file" type="file" accept=".wav,audio/wav" onChange={e=>setRefFile(e.target.files?.[0] || null)} /></label>
            <label className="hf-label">Reference Audio Transcript<textarea className="hf-reference-text" maxLength={MAX_REF_TEXT} value={refText} onChange={e=>setRefText(e.target.value)} placeholder="Reference WAV-এ যা বলা হয়েছে, হুবহু লিখুন…" /></label>
            <label className="hf-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} /> I have permission to use this reference voice.</label>
            <label className="hf-label" htmlFor="dh-bengali-text">বাংলা Text</label>
            <textarea id="dh-bengali-text" className="hf-main-text" maxLength={MAX_TEXT} value={text} onChange={e=>setText(e.target.value)} placeholder="এখানে বাংলা নিউজ স্ক্রিপ্ট লিখুন..." />
            <div className="editor-footer"><span>{text.length.toLocaleString()} / 250 characters</span><span>Limited free GPU</span><button className="primary" disabled={busy || !text.trim() || !refFile || !refText.trim() || !consent} onClick={generate}>{busy?'Generating…':'Generate'}</button></div>
          </section>
          <section className="panel output-panel"><h2>Current generation</h2>
            {!job && <div className="empty">Generate a script to see the audio here.</div>}
            {job?.status==='running' && <div className="empty">Hugging Face ZeroGPU is generating your Bengali audio…</div>}
            {job?.status==='completed' && <div className="hf-result"><span className="status completed">Completed</span><audio controls src={job.audio} preload="none"/><a className="button ghost" href={job.audio} download={job.filename}>Download WAV</a><p className="muted">{job.save_status}</p></div>}
            {job?.status==='failed' && <div className="error">Generation failed. See the error message above.</div>}
          </section>
        </div>
      </>}
      {tab==='history' && <section className="panel"><h2>Generation history (this tab only)</h2><p className="muted">Audio saves in the owner's private HF bucket. This local list resets on page refresh; there is no public cross-user history.</p>
        <div className="history-list">{history.length ? history.map(item => <div className="history-card" key={item.id}><div className="history-top"><strong>DH-TTS v0.1</strong><span className="status completed">completed</span></div><p>{item.text}</p><audio controls src={item.audio}/><a className="button ghost" href={item.audio} download={item.filename}>Download WAV</a></div>) : <div className="empty">No generations in this browser tab.</div>}</div></section>}
      {tab==='voices' && <section className="panel"><h2>Voice profiles</h2><p className="muted">Public Demo: provide your own authorized reference WAV and exact transcript on Generate. Stored user profiles require the original private backend.</p></section>}
      {tab==='pronunciation' && <section className="panel"><h2>BD-BN Pronunciation Dictionary</h2><p className="muted">The persistent dictionary requires the original private backend. Demo sends typed text directly to the model.</p></section>}
    </main>
  </div>
}
