import { authorized, json, sameOrigin } from '../lib/session.mjs'

const MAX_WAV_BYTES = 3 * 1024 * 1024
const MAX_AUDIO_OUT_BYTES = 3 * 1024 * 1024
const SPACE_URL = 'https://shariardipto-dh-tts-inference.hf.space'

async function parseSSE(response) {
  const body=await response.text()
  const segments=body.replace(/\r\n/g,'\n').split(/\n\s*\n/)
  for(const segment of segments) {
    const lines=segment.split('\n')
    const event=lines.find(x=>x.startsWith('event:'))?.slice(6).trim()
    const data=lines.filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim()).join('\n')
    if (event==='error') throw new Error('Hugging Face generation failed. Check Space Container Logs.')
    if (event==='complete') {
      let parsed
      try { parsed=JSON.parse(data) } catch { throw new Error('Invalid Gradio generation result.') }
      return parsed
    }
  }
  throw new Error('No complete Gradio response. Check ZeroGPU queue/quota or function timeout.')
}

export default async function handler(req) {
  if (req.method!=='POST') return json({error:'Method not allowed.'},405)
  if (!sameOrigin(req)) return json({error:'Invalid request origin.'},403)
  if (!authorized(req)) return json({error:'Session expired. Please sign in again.'},401)
  const token=process.env.HF_TOKEN
  if (!token) return json({error:'Netlify HF_TOKEN is missing.'},503)

  try {
    // Netlify synchronous functions have a 60s limit. Abort sooner for useful errors.
    const signal=AbortSignal.timeout(52_000)
    const form=await req.formData()
    const text=String(form.get('text') || '').trim()
    const refText=String(form.get('ref_text') || '').trim()
    const consent=form.get('consent')==='true'
    const file=form.get('ref_audio')
    if (!text || text.length>250 || !refText || refText.length>2000 || !consent)
      return json({error:'Provide text (max 250 characters), exact reference transcript, and voice consent.'},400)
    if (!(file instanceof File) || file.size===0 || file.size>MAX_WAV_BYTES || !/\.wav$/i.test(file.name))
      return json({error:'Please upload a WAV reference file of 3 MB or less.'},400)

    const headers={Authorization:`Bearer ${token}`}
    const uploadForm=new FormData()
    uploadForm.append('files',file,file.name)
    const uploadRes=await fetch(`${SPACE_URL}/gradio_api/upload`,{method:'POST',headers,body:uploadForm,signal})
    if (!uploadRes.ok) throw new Error(`Space reference upload failed (HTTP ${uploadRes.status}).`)
    const uploaded=await uploadRes.json()
    if (!Array.isArray(uploaded) || typeof uploaded[0]!=='string') throw new Error('Unexpected Gradio upload response.')

    const fileData={ path:uploaded[0], orig_name:file.name, meta:{_type:'gradio.FileData'} }
    const jobRes=await fetch(`${SPACE_URL}/gradio_api/call/generate`,{
      method:'POST',headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify({data:[text,fileData,refText,true]}),signal
    })
    if (!jobRes.ok) throw new Error(`Space generation request failed (HTTP ${jobRes.status}).`)
    const job=await jobRes.json()
    if (typeof job.event_id!=='string') throw new Error('Gradio did not return an event ID.')

    const resultRes=await fetch(`${SPACE_URL}/gradio_api/call/generate/${encodeURIComponent(job.event_id)}`,{headers,signal})
    if (!resultRes.ok) throw new Error(`Space result request failed (HTTP ${resultRes.status}).`)
    const data=await parseSSE(resultRes)
    if (!Array.isArray(data) || typeof data[0]?.url!=='string') throw new Error('Gradio did not return an audio file.')
    const fileURL=new URL(data[0].url,SPACE_URL)
    if(fileURL.protocol!=='https:' || fileURL.hostname!==new URL(SPACE_URL).hostname || fileURL.port)
      throw new Error('Unexpected audio file host. Audio was not downloaded.')

    const audioRes=await fetch(fileURL,{headers,signal})
    if (!audioRes.ok) throw new Error(`Private audio download failed (HTTP ${audioRes.status}).`)
    const sizeHint=Number(audioRes.headers.get('content-length')||0)
    if (sizeHint>MAX_AUDIO_OUT_BYTES) throw new Error('WAV saved to HF Bucket but exceeds demo download size limit.')
    const wav=Buffer.from(await audioRes.arrayBuffer())
    if (wav.byteLength>MAX_AUDIO_OUT_BYTES) throw new Error('WAV saved to HF Bucket but exceeds demo download size limit.')
    return json({
      audio_base64:wav.toString('base64'),
      filename:String(data[0].orig_name||'dh-tts.wav').replace(/[^a-zA-Z0-9_.-]/g,'_'),
      save_status:String(data[1]||'Generation completed')
    })
  } catch(error) {
    const message=error?.name==='TimeoutError' || error?.name==='AbortError'
      ? 'The generation exceeded Netlify’s 52-second demo timeout. Try shorter text or use an async backend.'
      : (error?.message||'Unknown generation error')
    // Avoid dumping private audio, tokens, or script into logs.
    return json({error:message},502)
  }
}
