import { networkInterfaces } from 'node:os'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createServer as createSecureServer } from 'node:https'
import { extname, join, resolve, sep } from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { decodeFrame, decodeJson, FrameType } from '@pixelsky/link'

export function localPhoneId(publicKey: string): string {
  return 'local-' + publicKey.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 56)
}

function lanAddress(): string | null {
  for (const entries of Object.values(networkInterfaces()))
    for (const entry of entries ?? [])
      if (entry.family === 'IPv4' && !entry.internal && /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(entry.address))
        return entry.address
  return null
}

/** 桌面端局域网手机连接。帧内容仍由 MobileGateway 做配对、Noise 握手和权限校验。 */
export class LocalMobileRelay {
  private server: Server | null = null
  private socketsServer: WebSocketServer | null = null
  private readonly sockets = new Map<string, WebSocket>()
  private readonly tokens = new Set<string>()
  private readonly tokenPhones = new Map<string, string>()
  private port = 0
  private readonly secure: boolean

  constructor(
    private readonly receive: (phone: string, frame: Uint8Array) => void,
    private readonly left: (phone: string) => void,
    private readonly webRoot: string,
    tls?: { cert: string; key: string },
  ) {
    this.secure = !!tls
    this.tls = tls
  }
  private readonly tls?: { cert: string; key: string }

  async start(): Promise<void> {
    if (this.server) return
    const handler = (request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): void => {
      const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
      if (pathname === '/') {
        response.writeHead(302, { Location: '/m/' }).end()
        return
      }
      const relative = pathname.startsWith('/m/') ? pathname.slice(3) : ''
      const root = resolve(this.webRoot)
      const file = resolve(root, relative || 'index.html')
      if (file !== root && !file.startsWith(root + sep)) {
        response.writeHead(404).end()
        return
      }
      const target = existsSync(file) && statSync(file).isFile() ? file : join(root, 'index.html')
      if (!existsSync(target)) {
        response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Mobile app assets are unavailable')
        return
      }
      const types: Record<string, string> = {
        '.css': 'text/css; charset=utf-8',
        '.html': 'text/html; charset=utf-8',
        '.ico': 'image/x-icon',
        '.js': 'text/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.svg': 'image/svg+xml',
        '.webmanifest': 'application/manifest+json',
        '.woff2': 'font/woff2',
      }
      response.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream' })
      createReadStream(target).pipe(response)
    }
    const server = this.tls
      ? createSecureServer({ cert: readFileSync(this.tls.cert), key: readFileSync(this.tls.key) }, handler)
      : createServer(handler)
    const sockets = new WebSocketServer({ noServer: true })
    server.on('upgrade', (request, socket, head) => {
      if (new URL(request.url ?? '/', 'http://localhost').pathname !== '/v1/bridge/ws') {
        socket.destroy()
        return
      }
      sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws, request))
    })
    this.server = server
    this.socketsServer = sockets
    await new Promise<void>((resolvePromise, reject) => {
      server.once('listening', resolvePromise)
      server.once('error', reject)
      server.listen(0, '0.0.0.0')
    })
    this.port = (server.address() as { port: number }).port
    sockets.on('connection', (socket, request) => {
      const protocols = String(request.headers['sec-websocket-protocol'] ?? '')
        .split(',')
        .map(v => v.trim())
      const token = protocols.find(v => v.startsWith('bearer.'))?.slice('bearer.'.length)
      if (!token || !this.tokens.has(token)) return socket.close(4001, 'unauthorized')
      socket.send(JSON.stringify({ type: 'desktop_online' }))
      let phone: string | null = this.tokenPhones.get(token) ?? null
      socket.on('message', data => {
        const frame = new Uint8Array(data as Buffer)
        if (!phone) {
          try {
            const decoded = decodeFrame(frame)
            if (decoded.type !== FrameType.Pair) return
            const request = decodeJson(decoded.body) as { key?: unknown }
            if (typeof request.key !== 'string') return
            phone = localPhoneId(request.key)
            this.tokenPhones.set(token, phone)
            this.sockets.set(phone, socket)
          } catch {
            return
          }
        }
        this.receive(phone, frame)
      })
      socket.on('close', () => {
        if (phone && this.sockets.get(phone) === socket) {
          this.sockets.delete(phone)
          this.left(phone)
        }
      })
    })
  }

  prepare(secret: string): { relay: string; web: string } | null {
    const address = lanAddress()
    if (!address || !this.port) return null
    const token = 'local.' + secret
    this.tokens.add(token)
    const protocol = this.secure ? 'wss' : 'ws'
    const webProtocol = this.secure ? 'https' : 'http'
    return {
      relay: `${protocol}://${address}:${this.port}/v1/bridge/ws`,
      web: `${webProtocol}://${address}:${this.port}/m/`,
    }
  }

  webUrl(): string | null {
    const address = lanAddress()
    return address && this.port ? `${this.secure ? 'https' : 'http'}://${address}:${this.port}/m/` : null
  }

  send(phone: string, frame: Uint8Array): boolean {
    const socket = this.sockets.get(phone)
    if (!socket || socket.readyState !== socket.OPEN) return false
    socket.send(frame)
    return true
  }

  url(): string | null {
    const address = lanAddress()
    return address && this.port ? `${this.secure ? 'wss' : 'ws'}://${address}:${this.port}/v1/bridge/ws` : null
  }

  close(): void {
    for (const socket of this.sockets.values()) socket.close()
    this.sockets.clear()
    this.tokens.clear()
    this.tokenPhones.clear()
    this.socketsServer?.close()
    this.server?.close()
    this.server = null
    this.socketsServer = null
    this.port = 0
  }
}
