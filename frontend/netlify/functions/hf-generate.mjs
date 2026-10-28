import { json, sameOrigin } from '../lib/http.mjs'
import { consumeQuota, DAILY_IP_LIMIT, DAILY_SITE_LIMIT } from '../lib/quota.mjs'

const MAX_WAV_BYTES = 3 * 1024 * 1024
const MAX_AUDIO_OUT_BYTES = 3 * 1024 * 1024
const SPACE_URL = 'https://shariardipto-dh-tts-inference.hf.space'
const REQUEST_TIMEOUT_MS = 52_000

function isValidWav(wav) {
  // Accept standard RIFF WAVE PCM/float, <=15s, 8–48 kHz, mono/stereo.
  if (wav.length < 44 || wav.toString('ascii',0,4)!=='RIFF' || wav.toString('ascii',8,12)!=='WAVE') return false
  const declared = wav.readUInt32LE(4)+8
  if (declared > wav.length || declared < 44) return false
  let pos=12, fmt=null, dataSize=0
  while (pos+8 <= declared) {
    const fourcc=wav.toString('ascii',pos,pos+4)
    const size=wav.readUInt32LE(pos+4)
    const begin=pos+8
    if (size > declared-begin) return false
    if (fourcc==='fmt ' && size >=16) {
      fmt={type:wav.readUInt16LE(begin), channels:wav.readUInt16LE(begin+2),
        rate:wav.readUInt32LE(begin+4), bytesPerSecond:wav.readUInt32LE(begin+8),
        align:wav.readUInt16LE(begin+12), bits:wav.readUInt16LE(begin+14)}
    }
    if (fourcc==='data') dataSize += size
    pos=begin + size + (size%2)
  }
  if (!fmt || ![1,3].includes(fmt.type) || ![1,2].includes(fmt.channels)) return false
  if (fmt.rate < 8000 || fmt.rate>48000 || ![8,16,24,32].includes(fmt.bits)) return false
  if (fmt.align !== fmt.channels*fmt.bits/8 || fmt.bytesPerSecond!==fmt.rate*fmt.align) return false
  const seconds = dataSize / fmt.bytesPerSecond
  return dataSize>0 && seconds>=1 && seconds<=30
}

async function getSSEComplete(response) {
  const body=await response.text()
  const segments=body.replace(/\r\n/g,'\n').split(/\n\s*\n/)
  for (const segment of segments) {
    const lines=segment.split('\n')
    const event=lines.find(x=>x.startsWith('event:'))?.slice(6).trim()
    const data=lines.filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim()).join('\n')
    if (event==='error') throw new Error('Hugging Face inference failed. Try later.')
    if (event==='complete') {
      try {return JSON.parse(data)} catch {throw new Error('Invalid Gradio result.')}
    }
  }
  throw new Error('No complete Gradio response. The GPU queue may be busy.')
}

function quotaError(reason) {
  if (reason==='ip_daily') return `Daily visitor limit (${DAILY_IP_LIMIT}) reached. Try tomorrow (UTC).`
  if (reason==='site_daily') return `The public demo's daily limit (${DAILY_SITE_LIMIT}) is full. Try tomorrow (UTC).`
  if (reason==='cooldown') return 'Please wait at least 2 minutes between requests.'
  return 'Generation limit reached. Try later.'
}

export default async function handler(req) {
  if (req.method!=='POST') return json({error:'Method not allowed.'},405)
  if (!sameOrigin(req)) return json({error:'Invalid request origin.'},403)
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='multipart/form-data')
    return json({error:'Expected multipart/form-data.'},415)
  const token=process.env.HF_TOKEN
  if (!token) return json({error:'Service is temporarily unavailable.'},503)
  const clen=Number(req.headers.get('content-length')||0)
  if (clen>4*1024*1024) return json({error:'Upload exceeds size limit.'},413)

  try {
    // Validate before consuming a public request slot.
    const form=await req.formData()
    const text=String(form.get('text')||'').trim()
    const refText=String(form.get('ref_text')||'').trim()
    const consent=form.get('consent')==='true'
    const file=form.get('ref_audio')
    if (!text || text.length>250 || !refText || refText.length>1000 || !consent)
      return json({error:'Provide text (max 250 chars), reference transcript (max 1000), and voice consent.'},400)
    if (!(file instanceof File) || file.size<44 || file.size>MAX_WAV_BYTES || !/\.wav$/i.test(file.name))
      return json({error:'Upload a valid WAV file of up to 2 MB.'},400)
    const wavBuffer=Buffer.from(await file.arrayBuffer())
    if (!isValidWav(wavBuffer)) return json({error:'Reference must be a standard PCM/float WAV (1–15 sec, 8–48 kHz).'},400)
    let quota
    try {quota = await consumeQuota(req)}
    catch {return json({error:'Public generation is paused: quota service unavailable or not configured.'},503)}
    if (!quota.allowed) return json({error:quotaError(quota.reason)},429,{'Retry-After':'120'})

    const signal=AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const headers={Authorization:`Bearer ${token}`}
    const uploadForm=new FormData()
    uploadForm.append('files', new Blob([wavBuffer],{type:'audio/wav'}), 'reference.wav')
    const uploadRes=await fetch(`${SPACE_URL}/gradio_api/upload`,{method:'POST',headers,body:uploadForm,signal})
    if (!uploadRes.ok) throw new Error(`Private Space reference upload failed (HTTP ${uploadRes.status}).`)
    const uploaded=await uploadRes.json()
    if (!Array.isArray(uploaded) || typeof uploaded[0]!=='string') throw new Error('Unexpected Gradio reference upload result.')

    const ref={path:uploaded[0],orig_name:'reference.wav',meta:{_type:'gradio.FileData'}}
    const jobRes=await fetch(`${SPACE_URL}/gradio_api/call/generate`,{
      method:'POST',headers:{...headers,'Content-Type':'application/json'},
      body:JSON.stringify({data:[text,ref,refText,true]}),signal
    })
    if (!jobRes.ok) throw new Error(`Hugging Face request rejected (HTTP ${jobRes.status}).`)
    const job=await jobRes.json()
    if (typeof job.event_id!=='string') throw new Error('Gradio did not return an event ID.')

    const resultRes=await fetch(`${SPACE_URL}/gradio_api/call/generate/${encodeURIComponent(job.event_id)}`,{headers,signal})
    if (!resultRes.ok) throw new Error(`Hugging Face result failed (HTTP ${resultRes.status}).`)
    const data=await getSSEComplete(resultRes)
    if (!Array.isArray(data) || typeof data[0]?.url!=='string') throw new Error('No generated WAV returned by model.')
    const audioURL=new URL(data[0].url,SPACE_URL)
    if (audioURL.protocol!=='https:' || audioURL.hostname!==new URL(SPACE_URL).hostname || audioURL.port)
      throw new Error('Unexpected Gradio audio URL.')
    const audioRes=await fetch(audioURL,{headers,signal})
    if (!audioRes.ok) throw new Error(`Audio download failed (HTTP ${audioRes.status}).`)
    if (Number(audioRes.headers.get('content-length')||0)>MAX_AUDIO_OUT_BYTES)
      throw new Error('Generated audio saved to Bucket but is too large for web download.')
    const wav=Buffer.from(await audioRes.arrayBuffer())
    if (wav.length>MAX_AUDIO_OUT_BYTES) throw new Error('Generated audio saved to Bucket but exceeds web download size.')
    const filename=String(data[0].orig_name||'dh-tts.wav').replace(/[^a-zA-Z0-9_.-]/g,'_')
    return json({audio_base64:wav.toString('base64'),filename,save_status:String(data[1]||'Audio generated')})
  } catch(err) {
    const isTimeout=err?.name==='TimeoutError'||err?.name==='AbortError'
    return json({error:isTimeout?'Generation timed out. The ZeroGPU queue may be busy. Try again later.':(err?.message||'Generation failed.')},502)
  }
}

// Netlify Free-plan compatible edge/network rate limiting, BEFORE the function runs.
// A second, atomic daily quota is enforced by Upstash Redis inside the handler.
export const config = {
  path:'/api/generate',
  rateLimit:{windowLimit:2,windowSize:180,aggregateBy:['ip','domain']},
}
