// The only module that speaks to a chain. Everything else is local.
const URL_ = process.env.RPC_URL || 'http://127.0.0.1:8545'
let id = 0

export async function rpc (method, params = []) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
  })
  const j = await res.json()
  if (j.error) throw new Error(method + ': ' + (j.error.message || JSON.stringify(j.error)))
  return j.result
}

export const chainId = async () => Number(BigInt(await rpc('eth_chainId')))
export const balanceOf = async (addr) => BigInt(await rpc('eth_getBalance', [addr, 'latest']))
export const nonceOf = async (addr) => Number(BigInt(await rpc('eth_getTransactionCount', [addr, 'latest'])))
export const gasPrice = async () => BigInt(await rpc('eth_gasPrice'))
export const sendRaw = (raw) => rpc('eth_sendRawTransaction', [raw])
export async function receipt (hash, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const r = await rpc('eth_getTransactionReceipt', [hash])
    if (r) return r
    await new Promise((r2) => setTimeout(r2, 250))
  }
  return null
}
export const endpoint = () => URL_
