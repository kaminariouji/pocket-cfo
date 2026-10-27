// The offline claim rests on this guard: while it is installed, any socket or
// DNS lookup aimed outside loopback throws instead of quietly succeeding.
// These tests exercise it with no model, no chain and no network access.
import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import dns from 'node:dns'
import { state, report } from '../src/netguard.mjs'

// A bare socket does not connect on construction, so the guard is the only
// thing that can throw here.
const bare = () => new net.Socket()

test('options object aimed at a remote host is blocked and counted', () => {
  const before = state.blocked.length
  assert.throws(
    () => bare().connect({ host: 'example.com', port: 443 }),
    (err) => err.code === 'EGRESS_BLOCKED' && /example.com/.test(err.message)
  )
  assert.equal(state.blocked.length, before + 1)
  assert.equal(state.blocked.at(-1), 'example.com')
})

test('positional form connect(port, host) is blocked too', () => {
  const before = state.blocked.length
  assert.throws(
    () => bare().connect(80, 'evil.test'),
    (err) => err.code === 'EGRESS_BLOCKED'
  )
  assert.equal(state.blocked.length, before + 1)
  assert.equal(state.blocked.at(-1), 'evil.test')
})

test('dns lookup of a non-loopback name fails instead of resolving', (t, done) => {
  const before = state.blocked.length
  dns.lookup('example.com', (err) => {
    try {
      assert.equal(err.code, 'EGRESS_BLOCKED')
      assert.equal(state.blocked.length, before + 1)
      assert.equal(state.blocked.at(-1), 'dns:example.com')
      done()
    } catch (e) { done(e) }
  })
})

test('loopback stays reachable so the local model and anvil can connect', () => {
  const before = state.allowedLoopback
  const socket = bare().connect({ host: '127.0.0.1', port: 9 })
  socket.on('error', () => {})
  assert.equal(state.allowedLoopback, before + 1)
  socket.destroy()
})

test('a pipe path is local and therefore allowed', () => {
  const before = state.allowedLoopback
  const socket = bare()
  try {
    socket.connect({ path: '\\\\.\\pipe\\nonexistent' })
  } catch (err) {
    assert.notEqual(err.code, 'EGRESS_BLOCKED')
  }
  socket.on('error', () => {})
  assert.equal(state.allowedLoopback, before + 1)
  socket.destroy()
})

test('report() summarises the block count and the first hosts', () => {
  const r = report()
  assert.ok(r.external_blocked >= 3, 'expected the three blocks above to be counted')
  assert.equal(r.hosts.length, Math.min(5, r.external_blocked))
  assert.ok(r.loopback_connections >= 2)
})
