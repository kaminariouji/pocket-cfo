// Offline step 2: WDK owns the key and the rules. The model can be wrong; the
// policy engine is the trust boundary, and it sits inside the wallet rather
// than in a prompt. A denied intent never produces a signature.
import WDK, { PolicyViolationError } from '@tetherto/wdk'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { readFileSync } from 'node:fs'

const wei = (eth) => BigInt(Math.round(Number(eth) * 1e6)) * 10n ** 12n

export function openWallet ({ seed, provider, registry, paidInvoices = [] }) {
  const byAddress = new Map(registry.payees.map((p) => [p.address.toLowerCase(), p]))
  const cap = wei(registry.policy.per_tx_cap_eth)
  const dailyCap = wei(registry.policy.daily_cap_eth)
  const paid = new Set(paidInvoices)
  const spent = { wei: 0n }

  const invoiceOf = (tx) => {
    const data = String(tx?.data || '')
    if (!data || data === '0x') return ''
    try { return Buffer.from(data.slice(2), 'hex').toString('utf8') } catch { return '' }
  }

  const wdk = new WDK(seed)
    .registerWallet('ethereum', WalletManagerEvm, { provider })
    .registerPolicy({
      id: 'spend-guard',
      name: 'Owner-approved payees, per-tx and daily caps, no duplicate invoice',
      scope: 'project',
      rules: [
        {
          name: 'invoice-already-paid',
          operation: 'signTransaction',
          action: 'DENY',
          conditions: [({ args }) => paid.has(invoiceOf(args[0]))]
        },
        {
          name: 'payee-not-allowlisted',
          operation: 'signTransaction',
          action: 'DENY',
          conditions: [({ args }) => !byAddress.has(String(args[0]?.to || '').toLowerCase())]
        },
        {
          name: 'over-per-tx-cap',
          operation: 'signTransaction',
          action: 'DENY',
          conditions: [({ args }) => BigInt(args[0]?.value || 0n) > cap]
        },
        {
          name: 'over-daily-cap',
          operation: 'signTransaction',
          action: 'DENY',
          conditions: [({ args }) => spent.wei + BigInt(args[0]?.value || 0n) > dailyCap]
        },
        { name: 'routine-payment', operation: 'signTransaction', action: 'ALLOW', conditions: [] }
      ]
    })

  return {
    wdk,
    policy: { cap, dailyCap },
    payeeOf: (addr) => byAddress.get(String(addr).toLowerCase()) || null,
    invoiceOf,
    markPaid: (invoice, valueWei) => { if (invoice) paid.add(invoice); spent.wei += valueWei },
    spentWei: () => spent.wei,
    async account () { return wdk.getAccount('ethereum', 0) }
  }
}

export { PolicyViolationError }

export function loadRegistry (url) {
  return JSON.parse(readFileSync(url, 'utf8'))
}
