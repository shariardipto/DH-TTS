import React, { useEffect, useMemo, useState } from 'react'
import { api, clearToken, getToken, getGenerationAudioBlob, setToken } from './api'

function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
      setToken(data.access_token); onLogin(data.user)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return <div className="login-shell">
    <form className="login-card" onSubmit={submit}>
      <div className="brand-mark">DH</div>
      <h1>Dhaka Heralds</h1><p>Voice Platform</p>
      <label>Username<input value={username} onChange={e=>setUsername(e.target.value)} autoFocus /></label>
      <label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} /></label>
      {error && <div className="error">{error}</div>}
      <button className="primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </div>
}

function SecureAudio({ generationId, autoLoad = false }) {
  const [audioUrl, setAudioUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let url = ''
    async function load() {
      if (!autoLoad || !generationId) return
      setLoading(true); setError('')
      try {
        const blob = await getGenerationAudioBlob(generationId)
        if (!active) return
        url = URL.createObjectURL(blob)
        setAudioUrl(url)
      } catch (e) {
        if (active) setError(e.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [generationId, autoLoad])

  if (error) return <div className="error">{error}</div>
  if (loading) return <p className="muted">Loading protected audio…</p>
  if (!audioUrl) return <span className="muted">Audio unavailable</span>
  return <div className="audio-player"><audio controls src={audioUrl} preload="none" />
    <a className="button ghost" href={audioUrl} download={`${generationId}.wav`}>Download WAV</a>
  </div>
}

function GenerationCard({ item, onRefresh, onCorrect }) {
  const [showAudio, setShowAudio] = useState(false)
  return <div className="history-card">
    <div className="history-top"><strong>{item.model_name}</strong><span className={`status ${item.status}`}>{item.status}</span></div>
    <p>{item.raw_text.slice(0, 180)}{item.raw_text.length > 180 ? '…' : ''}</p>
    {item.status === 'running' && <div className="progress"><span style={{width:`${item.progress}%`}} /></div>}
    {item.status === 'completed' && showAudio && <SecureAudio generationId={item.id} autoLoad />}
    {item.status === 'failed' && <div className="error">{item.error_message}</div>}
    <div className="row gap">
      {item.status === 'completed' && !showAudio && <button className="button ghost" onClick={()=>setShowAudio(true)}>Play / Download WAV</button>}
      {item.status === 'completed' && <button className="button ghost" onClick={()=>api(`/api/generations/${item.id}/approve`,{method:'POST'}).then(onRefresh)}>Approve</button>}
      {item.status === 'completed' && <button className="button ghost" onClick={()=>onCorrect(item)}>Report correction</button>}
    </div>
  </div>
}

function App() {
  const [user, setUser] = useState(null)
  const [tab, setTab] = useState('generate')
  const [voices, setVoices] = useState([])
  const [history, setHistory] = useState([])
  const [rules, setRules] = useState([])
  const [text, setText] = useState('')
  const [voiceId, setVoiceId] = useState('')
  const [job, setJob] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [ruleSource, setRuleSource] = useState('')
  const [ruleReplacement, setRuleReplacement] = useState('')
  const [correction, setCorrection] = useState(null)
  const [corrCategory, setCorrCategory] = useState('pronunciation')
  const [corrOriginal, setCorrOriginal] = useState('')
  const [corrFixed, setCorrFixed] = useState('')
  const [corrNote, setCorrNote] = useState('')

  const isAdmin = user?.role === 'admin'
  const charCount = useMemo(()=>text.length,[text])

  async function loadAll() {
    const [v,h,r] = await Promise.all([api('/api/voices'), api('/api/generations?limit=50'), api('/api/pronunciations')])
    setVoices(v); setHistory(h); setRules(r); if (!voiceId && v[0]) setVoiceId(v[0].id)
  }

  useEffect(()=>{
    if (!getToken()) return
    api('/api/auth/me').then(setUser).catch(()=>clearToken())
  },[])
  useEffect(()=>{ if(user) loadAll().catch(e=>setError(e.message)) },[user])
  useEffect(()=>{
    const f=()=>{setUser(null);clearToken()}; window.addEventListener('dh-auth-expired',f); return()=>window.removeEventListener('dh-auth-expired',f)
  },[])

  useEffect(()=>{
    if (!job || !['pending','running'].includes(job.status)) return
    const timer=setInterval(async()=>{
      try {
        const next=await api(`/api/generations/${job.id}`); setJob(next)
        if(['completed','failed'].includes(next.status)) { clearInterval(timer); loadAll() }
      } catch(e){ setError(e.message) }
    },1200)
    return()=>clearInterval(timer)
  },[job?.id, job?.status])

  async function generate() {
    if(!text.trim() || !voiceId) return
    setBusy(true); setError('')
    try {
      const next=await api('/api/generations',{method:'POST',body:JSON.stringify({text,voice_id:voiceId})}); setJob(next)
    } catch(e){setError(e.message)} finally{setBusy(false)}
  }

  async function addRule(e) {
    e.preventDefault()
    await api('/api/pronunciations',{method:'POST',body:JSON.stringify({source_text:ruleSource,replacement_text:ruleReplacement})})
    setRuleSource('');setRuleReplacement('');loadAll()
  }

  async function submitCorrection(e) {
    e.preventDefault()
    await api('/api/corrections',{method:'POST',body:JSON.stringify({generation_id:correction.id,category:corrCategory,original_text:corrOriginal||null,corrected_text:corrFixed||null,note:corrNote||null})})
    setCorrection(null); setCorrOriginal('');setCorrFixed('');setCorrNote(''); loadAll()
  }

  if (!user) return <Login onLogin={setUser} />

  return <div className="app-shell">
    <aside>
      <div className="brand"><div className="brand-mark small">DH</div><div><strong>Dhaka Heralds</strong><span>Voice Platform</span></div></div>
      <nav>
        {['generate','history','voices','pronunciation'].map(x=><button key={x} className={tab===x?'active':''} onClick={()=>setTab(x)}>{x[0].toUpperCase()+x.slice(1)}</button>)}
      </nav>
      <div className="model-pill"><span className="dot"/> DH-TTS <small>v 0.1 fine-tuned</small></div>
      <div className="profile"><strong>{user.full_name}</strong><span>{user.role}</span><button onClick={()=>{clearToken();setUser(null)}}>Sign out</button></div>
    </aside>
    <main>
      <header><div><h1>{tab==='generate'?'Text to Speech':tab[0].toUpperCase()+tab.slice(1)}</h1><p>Bangladesh Bangla newsroom voice generation</p></div><div className="engine">Engine <strong>DH-TTS</strong></div></header>
      {error && <div className="error banner">{error}</div>}

      {tab==='generate' && <div className="grid two">
        <section className="panel editor-panel">
          <div className="field-row"><label>Voice<select value={voiceId} onChange={e=>setVoiceId(e.target.value)}>{voices.map(v=><option key={v.id} value={v.id}>{v.name} — {v.style}</option>)}</select></label><label>Mode<input value="Bangladesh Bangla" disabled/></label></div>
          <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="এখানে বাংলা নিউজ স্ক্রিপ্ট লিখুন..." />
          <div className="editor-footer"><span>{charCount.toLocaleString()} characters</span><span>Auto chunking: ON · Kaggle GPU works while notebook is active</span><button className="primary" disabled={busy || !voices.length} onClick={generate}>{busy?'Queueing…':'Generate'}</button></div>
        </section>
        <section className="panel output-panel">
          <h2>Current generation</h2>
          {!job && <div className="empty">Generate a script to see the job here.</div>}
          {job && <>
            <div className="job-head"><span className={`status ${job.status}`}>{job.status}</span><strong>{job.progress}%</strong></div>
            <div className="progress large"><span style={{width:`${job.progress}%`}} /></div>
            {job.status==='completed' && <SecureAudio generationId={job.id} autoLoad />}
            {job.status==='failed' && <div className="error">{job.error_message}</div>}
          </>}
        </section>
      </div>}

      {tab==='history' && <section className="panel"><div className="section-title"><h2>Generation history</h2><button className="button ghost" onClick={loadAll}>Refresh</button></div><div className="history-list">{history.map(h=><GenerationCard key={h.id} item={h} onRefresh={loadAll} onCorrect={setCorrection}/>)}</div></section>}

      {tab==='voices' && <section className="panel"><h2>Voice profiles</h2><p className="muted">Voice upload is available through the admin API at <code>/docs</code> in this starter. A full upload form can be added next.</p><div className="cards">{voices.map(v=><div className="voice-card" key={v.id}><div className="avatar">{v.name.slice(0,2).toUpperCase()}</div><div><strong>{v.name}</strong><span>{v.style}</span><p>{v.reference_text.slice(0,120)}…</p></div></div>)}</div></section>}

      {tab==='pronunciation' && <section className="panel"><div className="section-title"><div><h2>BD-BN Pronunciation Dictionary</h2><p className="muted">Rules apply before DH-TTS receives the script.</p></div></div>{isAdmin && <form className="rule-form" onSubmit={addRule}><input placeholder="Written text" value={ruleSource} onChange={e=>setRuleSource(e.target.value)}/><span>→</span><input placeholder="Speak as" value={ruleReplacement} onChange={e=>setRuleReplacement(e.target.value)}/><button className="primary">Save rule</button></form>}<div className="rule-table"><div className="rule-row head"><span>Written</span><span>DH-TTS receives</span><span>Status</span></div>{rules.map(r=><div className="rule-row" key={r.id}><span>{r.source_text}</span><span>{r.replacement_text}</span><span>{r.is_active?'Active':'Off'}</span></div>)}</div></section>}
    </main>

    {correction && <div className="modal-bg"><form className="modal" onSubmit={submitCorrection}><h2>Report correction</h2><label>Category<select value={corrCategory} onChange={e=>setCorrCategory(e.target.value)}><option value="pronunciation">Pronunciation</option><option value="accent">Accent</option><option value="tone">Tone</option><option value="missing_word">Missing word</option><option value="pacing">Pacing</option><option value="other">Other</option></select></label><label>Original word / phrase<input value={corrOriginal} onChange={e=>setCorrOriginal(e.target.value)}/></label><label>Correct form<input value={corrFixed} onChange={e=>setCorrFixed(e.target.value)}/></label><label>Note<textarea value={corrNote} onChange={e=>setCorrNote(e.target.value)}/></label><div className="row gap"><button type="button" className="button ghost" onClick={()=>setCorrection(null)}>Cancel</button><button className="primary">Save correction</button></div></form></div>}
  </div>
}

export default App
