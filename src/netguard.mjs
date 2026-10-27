// Egress guard. Any outbound connection to a host that is not loopback throws
// and is counted. The offline phase runs with this installed, so a hosted API
// call would fail loudly instead of quietly working.
import net from 'node:net'
import dns from 'node:dns'

export const state = { blocked: [], allowedLoopback: 0 }

const LOOPBACK = /^(127\.\d+\.\d+\.\d+|::1|localhost|0\.0\.0\.0|\[::1\])$/i

function isLoopback (host) {
  if (!host) return true
  return LOOPBACK.test(String(host))
}

const origConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function (...args) {
  let host = ''
  const a0 = args[0]
  if (a0 && typeof a0 === 'object') host = a0.host || a0.path || ''
  else if (typeof args[1] === 'string') host = args[1]
  if (!isLoopback(host)) {
    state.blocked.push(String(host))
    const err = new Error('egress blocked: ' + host)
    err.code = 'EGRESS_BLOCKED'
    throw err
  }
  state.allowedLoopback++
  return origConnect.apply(this, args)
}

const origLookup = dns.lookup
dns.lookup = function (hostname, ...rest) {
  if (!isLoopback(hostname)) {
    state.blocked.push('dns:' + hostname)
    const err = new Error('dns blocked: ' + hostname)
    err.code = 'EGRESS_BLOCKED'
    const cb = rest[rest.length - 1]
    if (typeof cb === 'function') return process.nextTick(() => cb(err))
    throw err
  }
  return origLookup.call(this, hostname, ...rest)
}

export function report () {
  return { external_blocked: state.blocked.length, loopback_connections: state.allowedLoopback, hosts: state.blocked.slice(0, 5) }
}
