// The account service as a plain Node server (Node 24 runs index.ts as it is), in Kubernetes next to the gateway;
// its settings come from the environment (gateway/k8s/manul.yaml).
import { createServer } from 'node:http'
import { handle } from './index.ts'

createServer(async (req, res) => {
  if (req.url === '/healthz') return res.writeHead(200).end('ok')
  try {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
    const r = await handle(new Request(`http://localhost${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), process.env)
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()))
  } catch (e) {
    console.error(e)
    res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Something went wrong. Try again in a moment.' }))
  }
}).listen(Number(process.env.PORT || 8080))
