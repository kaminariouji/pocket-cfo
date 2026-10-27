# pocket-cfo

A payment agent that runs on your machine: a 1B model reads the instruction, the
wallet's own policy engine decides, the key signs offline, and exactly one step
touches the network — the broadcast.

Built for the QVAC "Agentic finance with WDK" track: QVAC for the local AI,
[WDK](https://docs.wdk.tether.io/) for the self-custodial wallet.

```
instruction  →  local model  →  validator  →  WDK policy  →  sign (offline)  →  broadcast
                QVAC 1B        registry       ALLOW/DENY     key never leaves    the only
                on device      allowlist      in-wallet      the process         network call
```

## What runs offline, what does not

| Step | Where | Network |
|---|---|---|
| Read the instruction (Llama 3.2 1B Q4_0) | local GGUF, CPU | **no** |
| Resolve the payee | local registry file | **no** |
| Decide ALLOW / DENY | WDK policy engine, in-process | **no** |
| Sign the transaction | WDK account, local key | **no** |
| Read nonce / gas price, broadcast | JSON-RPC | **yes** |

The offline steps run with an egress guard installed (`src/netguard.mjs`): any
socket to a non-loopback host throws and is counted. A hosted API call would fail
loudly instead of quietly succeeding. The demo prints the counter at the end —
it is 0, and the only loopback connections are the local model worker and the
local chain.

## The demo run

Four instructions, one signature. Numbers below are from `media/demo.mp4`, a
recorded run against a local anvil chain (id 31337, no real funds).

| # | Instruction | Model read | Decision | Outcome |
|---|---|---|---|---|
| 1 | Pay Acme the 0.004 ETH invoice INV-1042 | `{"action":"pay","payee":"acme","amount_eth":"0.004","invoice":"INV-1042"}` | ALLOW (routine-payment) | signed, broadcast, settled |
| 2 | …invoice INV-1042 **again** | same | DENY (invoice-already-paid) | refused before the key was used |
| 3 | Send 0.5 ETH to 0x9A1b…4567 | payee = the raw address | DENY (payee-not-allowlisted) | refused |
| 4 | Pay Northwind 0.02 ETH for INV-1044 | `{"payee":"Northwind","amount_eth":"0.02"}` | DENY (over-per-tx-cap) | refused |

Measured in that run: model 1.8–2.9 s per instruction on CPU, signature 8 ms,
1 signed, 3 blocked, 0 escalated, 0 external connections.

## Why the gate is in the wallet and not in the prompt

A 1B model will sometimes read the wrong number, or invent a payee. Prompt
instructions ("never send more than 0.01 ETH") are not enforcement — they are a
suggestion the next token can ignore.

So the model's output is treated as an *untrusted proposal*. It never supplies an
address: the validator resolves the payee name against a local registry, and
everything after that is a WDK policy rule evaluated inside the wallet, before
the signer is reached:

```js
.registerPolicy({
  id: 'spend-guard', scope: 'project',
  rules: [
    { name: 'invoice-already-paid',  operation: 'signTransaction', action: 'DENY', conditions: [...] },
    { name: 'payee-not-allowlisted', operation: 'signTransaction', action: 'DENY', conditions: [...] },
    { name: 'over-per-tx-cap',       operation: 'signTransaction', action: 'DENY', conditions: [...] },
    { name: 'over-daily-cap',        operation: 'signTransaction', action: 'DENY', conditions: [...] },
    { name: 'routine-payment',       operation: 'signTransaction', action: 'ALLOW', conditions: [] }
  ]
})
```

A denied intent throws `PolicyViolationError` before any signature exists, so
there is nothing to broadcast and nothing to leak. `account.simulate.signTransaction`
runs the same rules without executing, which is what the demo prints as the
decision line.

The invoice id travels as calldata (`0x` + UTF-8 of `INV-1042`), so the payment
reference is on-chain and the duplicate check has something durable to compare
against.

## Run it

```bash
npm install
anvil --port 8545 --chain-id 31337          # local test chain, no real funds
node src/demo.mjs                            # full run
node src/demo.mjs --offline-only             # stop before the broadcast
```

`npm test` runs the egress-guard tests — no model, no chain, no network. They check that a
socket or DNS lookup aimed anywhere but loopback throws, which is what makes the offline claim
checkable rather than asserted.

Requirements: Node >= 22.17, [Foundry](https://book.getfoundry.sh/) for `anvil`.
The model weights (Llama 3.2 1B Instruct Q4_0) are fetched once by `@qvac/sdk`
and then run from disk.

```
src/intent.mjs    QVAC model → intent JSON, with a validator that repairs and rejects
src/wallet.mjs    WDK wallet, derivation, policy rules, offline signing
src/netguard.mjs  egress guard used to prove the offline claim
src/rpc.mjs       the only module that opens a connection to a chain
src/demo.mjs      the four-instruction run
media/            recording harness (page + SSE server + playwright)
```

## What is real and what is not

- **Real**: the model inference, the WDK derivation and policy evaluation, the
  ECDSA signature, the transaction, the block, the balance change.
- **Not real**: the money. The chain is a local anvil instance and the seed is
  anvil's public test mnemonic (`test test … junk`), which is published in every
  Foundry tutorial. Never use it for value.
- The payee registry is a local JSON file standing in for an address book. A
  production wallet would read it from the user's own store.

## Limits

- One chain, one account, native transfers only. ERC-20 needs the `transfer`
  operation added to the policy set.
- The daily cap is tracked in process memory, so it resets when the process does.
  A durable version belongs in the same store as the invoice ledger.
- The model is a parser, not an advisor: it is asked for four fields and its
  output is validated. Anything it cannot express is escalated, never guessed.
- Broadcast is a plain JSON-RPC call. Fee bumping, nonce races and reorg handling
  are out of scope for this demo.

MIT licensed.

## What was built during the event

Built during AI Yako (QVAC Hackathon, 27 October 2026): the agent loop, the
intent validator, the WDK policy set (allowlisted payee, per-transaction cap,
daily cap, duplicate invoice), the offline signing path, the demo harness and
the video.

## Existing code and third-party work

No existing project of mine was submitted to this track. Third-party work is
used as published libraries, not as copied source:

- `@qvac/sdk` 0.22.0 (Apache-2.0) for local inference, with the Llama 3.2 1B
  Instruct Q4_0 weights served by the QVAC registry.
- `@tetherto/wdk` 1.0.0-beta.22 and `@tetherto/wdk-wallet-evm` (Apache-2.0)
  for derivation and signing.
- Foundry `anvil` (MIT) as the local test chain, using anvil's public test
  mnemonic for the demo wallet.
