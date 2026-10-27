// Offline step 1: a 1B model reads the instruction and returns a payment intent.
// It never sees a private key and never supplies an address it invented — the
// validator resolves the payee against the owner's registry, and the wallet
// policy decides whether the intent may become a signature.
import { loadModel, completion, unloadModel, LLAMA_3_2_1B_INST_Q4_0 } from '@qvac/sdk'

const SYSTEM = [
  'You convert one payment instruction into JSON.',
  'Reply with one JSON object and nothing else. No prose, no code fences.',
  'Keys: action, payee, amount_eth, invoice.',
  'action is "pay" or "none". payee is copied from the instruction. amount_eth is a decimal string. invoice is copied from the instruction.',
  'Example: instruction "pay acme 0.004 eth for INV-9" -> {"action":"pay","payee":"acme","amount_eth":"0.004","invoice":"INV-9"}'
].join(' ')

let modelId = null
let loadMs = 0

export async function loadParser () {
  if (modelId) return modelId
  const t0 = Date.now()
  modelId = await loadModel({
    modelSrc: LLAMA_3_2_1B_INST_Q4_0,
    modelType: 'llm',
    modelConfig: { ctx_size: 2048, gpu_layers: 0, device: 'cpu' }
  })
  loadMs = Date.now() - t0
  return modelId
}

export const parserLoadMs = () => loadMs

export async function parseInstruction (text) {
  await loadParser()
  const t0 = performance.now()
  const res = completion({
    modelId,
    history: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: text }
    ],
    stream: true,
    generationParams: { temp: 0, top_p: 0.9, predict: 96 }
  })
  let out = ''
  for await (const tok of res.tokenStream) out += tok
  const ms = performance.now() - t0
  const json = extractJson(out)
  return { raw: out.trim(), intent: json, ms }
}

function extractJson (text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  const slice = text.slice(start, end + 1)
  try { return JSON.parse(slice) } catch {}
  // A 1B model sometimes drops a quote. Repair the one field at a time.
  const repaired = slice
    .replace(/,\s*}/g, '}')
    .replace(/([{,]\s*)([a-z_]+)\s*:/gi, '$1"$2":')
    .replace(/:\s*([A-Za-z][A-Za-z0-9_.-]*)([,}])/g, ':"$1"$2')
  try { return JSON.parse(repaired) } catch { return null }
}

export async function unloadParser () {
  if (modelId) { await unloadModel({ modelId }); modelId = null }
}
