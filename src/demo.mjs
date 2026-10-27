// pocket-cfo — one run, four instructions, one real signature.
// Offline: model parse, payee resolution, policy decision, signing.
// Online: exactly one call, the broadcast.
import { readFileSync } from 'node:fs'
import * as guard from './netguard.mjs'
import * as chain from './rpc.mjs'
import { openWallet, PolicyViolationError } from './wallet.mjs'
import { parseInstruction, unloadParser, parserLoadMs } from './intent.mjs'

const registry = JSON.parse(readFileSync(new URL('./registry.json', import.meta.url), 'utf8'))
const TEST_SEED = process.env.TEST_SEED || 'test test test test test test test test test test test junk'
const OFFLINE_ONLY = process.argv.includes('--offline-only')

const CASES = [
  'Pay Acme the 0.004 ETH invoice INV-1042.',
  'Pay Acme the 0.004 ETH invoice INV-1042 again.',
  'Send 0.5 ETH to 0x9A1b2C3d4E5f60718293a4B5c6D7e8F901234567.',
  'Pay Northwind 0.02 ETH for invoice INV-1044.'
]

const ETH = (w) => (Number(w) / 1e18).toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4)
const pad = (s, n) => String(s).padEnd(n)
const rule = (n) => '─'.repeat(n)

function hexOf (text) { return '0x' + Buffer.from(text, 'utf8').toString('hex') }
function gasFor (data) {
  let g = 21000
  const bytes = Buffer.from(data.slice(2), 'hex')
  for (const b of bytes) g += b === 0 ? 4 : 16
  return BigInt(g + 2000)
}

const lines = []
const say = (s = '') => { lines.push(s); console.log(s) }

say(rule(84))

const chainId = await chain.chainId()
const wallet = openWallet({ seed: TEST_SEED, provider: chain.endpoint(), registry })
const acct = await wallet.account()
const address = await acct.getAddress()
let nonce = await chain.nonceOf(address)
const gasPrice = await chain.gasPrice()
const startBalance = await chain.balanceOf(address)

say(pad('chain', 13) + chainId + '  ' + chain.endpoint() + '   (local test chain, no real funds)')
say(pad('wallet', 13) + short(address) + '  ' + acct.path)
say(pad('balance', 13) + ETH(startBalance) + ' ETH')
say(pad('policy', 13) + 'cap ' + registry.policy.per_tx_cap_eth + ' ETH/tx · ' + registry.policy.daily_cap_eth + ' ETH/day · ' + registry.payees.length + ' allowlisted payees')
say('')

say(pad('model', 13) + 'loading Llama 3.2 1B Q4_0 from a local file …')
await parseInstruction('warm up')
say(pad('model', 13) + 'Llama 3.2 1B Q4_0 · local file · loaded in ' + parserLoadMs() + ' ms')
say('')

let signed = 0
let blocked = 0
let escalated = 0
let moved = 0n
let gasSpent = 0n

for (let i = 0; i < CASES.length; i++) {
  const text = CASES[i]
  say(rule(84))
  say('#' + (i + 1) + '  ' + text)

  const parsed = await parseInstruction(text)
  const intent = parsed.intent
  if (!intent) {
    escalated++
    say(pad('model', 13) + (parsed.ms / 1000).toFixed(1) + 's  unparseable: ' + JSON.stringify(parsed.raw.slice(0, 60)))
    say(pad('decision', 13) + 'NEEDS_HUMAN — no intent, nothing signed')
    continue
  }
  say(pad('model', 13) + (parsed.ms / 1000).toFixed(1) + 's  ' + JSON.stringify(intent))

  if (String(intent.action || '').toLowerCase() !== 'pay') {
    escalated++
    say(pad('decision', 13) + 'NEEDS_HUMAN — model read no payment, nothing signed')
    continue
  }

  const amountEth = String(intent.amount_eth || '').replace(/[^0-9.]/g, '')
  const value = BigInt(Math.round(Number(amountEth) * 1e6)) * 10n ** 12n
  const payeeKey = String(intent.payee || '').toLowerCase().trim()
  const hit = registry.payees.find((p) => p.name === payeeKey || p.label.toLowerCase() === payeeKey)
  const to = hit ? hit.address : (/^0x[0-9a-fA-F]{40}$/.test(intent.payee || '') ? intent.payee : null)
  const invoice = String(intent.invoice || '').trim()

  if (!to || !(value > 0n)) {
    escalated++
    say(pad('resolve', 13) + 'no address for "' + payeeKey + '" — nothing signed')
    say(pad('decision', 13) + 'NEEDS_HUMAN')
    continue
  }

  const data = invoice ? hexOf(invoice) : '0x'
  const tx = {
    to,
    value,
    data,
    nonce,
    gasLimit: gasFor(data),
    maxFeePerGas: gasPrice * 2n,
    maxPriorityFeePerGas: 1000000000n,
    chainId
  }
  say(pad('resolve', 13) + (hit ? hit.name : 'raw address') + ' → ' + short(to) + ' · ' + ETH(value) + ' ETH' + (invoice ? ' · ref ' + invoice : ''))

  const sim = await acct.simulate.signTransaction(tx)
  say(pad('policy', 13) + sim.decision + '  (' + sim.matched_rule + ')')

  if (sim.decision !== 'ALLOW') {
    blocked++
    try {
      await acct.signTransaction(tx)
      say(pad('signature', 13) + 'UNEXPECTED — policy allowed what it denied in simulation')
    } catch (err) {
      if (err instanceof PolicyViolationError) {
        say(pad('signature', 13) + 'refused — PolicyViolationError(' + err.ruleName + ') before the key was used')
      } else {
        say(pad('signature', 13) + 'error ' + err.message)
      }
    }
    continue
  }

  const t0 = performance.now()
  const raw = await acct.signTransaction(tx)
  const signMs = (performance.now() - t0).toFixed(1)
  say(pad('signature', 13) + 'local, ' + raw.length + ' hex chars, ' + signMs + ' ms, no provider call')

  // A signature is irrevocable: the signed transaction can still be broadcast
  // later, so the invoice is spent the moment the key is used — not when the
  // broadcast succeeds. Without this, --offline-only would let the same invoice
  // through twice and the run would not match the table in the README.
  wallet.markPaid(invoice, value)

  if (OFFLINE_ONLY) {
    signed++
    say(pad('broadcast', 13) + 'skipped (--offline-only) — invoice marked spent')
    continue
  }

  const hash = await chain.sendRaw(raw)
  const rc = await chain.receipt(hash)
  const fee = rc ? BigInt(rc.gasUsed) * BigInt(rc.effectiveGasPrice || 0) : 0n
  moved += value
  gasSpent += fee
  signed++
  nonce++
  say(pad('broadcast', 13) + 'ONLINE · ' + hash.slice(0, 22) + '… · block ' + (rc ? Number(BigInt(rc.blockNumber)) : 'pending'))
  say(pad('settled', 13) + ETH(value) + ' ETH → ' + short(to) + ' · fee ' + ETH(fee) + ' ETH')
}

say(rule(84))
const endBalance = await chain.balanceOf(address)
const g = guard.report()
say(pad('result', 13) + signed + ' signed · ' + blocked + ' blocked by policy · ' + escalated + ' escalated · 0 unsigned payments')
say(pad('chain', 13) + ETH(moved) + ' ETH moved · ' + ETH(gasSpent) + ' ETH gas · balance ' + ETH(endBalance) + ' ETH')
say(pad('egress', 13) + g.external_blocked + ' external connections blocked · ' + g.loopback_connections + ' loopback (local model worker, local chain)')
say(rule(84))

await unloadParser()
wallet.wdk.dispose()
