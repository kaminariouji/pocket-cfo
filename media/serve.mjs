import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'

const PORT = Number(process.env.PORT || 7799)
const ROOT = 'C:/CRYPTO MONEY MAKER/tmp/wdkfin'
const html = readFileSync(ROOT + '/media/page.html', 'utf8')

createServer((req, res) => {
  if (req.url === '/run') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    const child = spawn(process.execPath, ['src/demo.mjs'], { cwd: ROOT })
    const send = (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (line.length === 0) res.write('data: \n\n')
        else res.write('data: ' + line + '\n\n')
      }
    }
    child.stdout.on('data', send)
    child.stderr.on('data', send)
    child.on('close', () => { res.write('event: done\ndata: end\n\n'); res.end() })
    req.on('close', () => child.kill())
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(html)
}).listen(PORT, '127.0.0.1', () => console.log('http://127.0.0.1:' + PORT))
