import { Server } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { bridgeProtocols, encodeFrame, encodeJson, FrameType, generateKeypair, toBase64Url } from '@pixelsky/link'
import { LocalMobileRelay, localPhoneId } from './local-relay'

const relays: LocalMobileRelay[] = []
const clients: WebSocket[] = []

afterEach(() => {
  for (const client of clients) client.terminate()
  clients.length = 0
  for (const relay of relays) relay.close()
  relays.length = 0
  vi.restoreAllMocks()
})

function createRelay(): LocalMobileRelay {
  const relay = new LocalMobileRelay(
    () => {},
    () => {},
    '.',
  )
  relays.push(relay)
  return relay
}

function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url, bridgeProtocols('local.refresh-test'))
  clients.push(socket)
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

describe('LocalMobileRelay port selection', () => {
  it('starts at 9080, advances one port per conflict and reuses the first free port after restart', async () => {
    const listen = vi.spyOn(Server.prototype, 'listen')
    const first = createRelay()
    await first.start()
    const firstUrl = first.webUrl()
    expect(firstUrl).not.toBeNull()
    const firstPort = Number(new URL(firstUrl!).port)
    listen.mockClear()

    const second = createRelay()
    await second.start()
    const offer = second.prepare('refresh-test')!
    const secondPort = Number(new URL(offer.web).port)
    expect(secondPort).toBeGreaterThan(firstPort)
    expect(Number(new URL(offer.relay).port)).toBe(secondPort)
    expect(listen.mock.calls.map(args => args[0])).toEqual(
      Array.from({ length: secondPort - 9080 + 1 }, (_, offset) => 9080 + offset),
    )
    await connect(`ws://127.0.0.1:${secondPort}/v1/bridge/ws`)

    first.close()
    await first.start()
    expect(first.webUrl()).toBe(firstUrl)
  })

  it('reports other bind errors and allows a subsequent start', async () => {
    const denied = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const listen = vi.spyOn(Server.prototype, 'listen').mockImplementationOnce(function (this: Server) {
      queueMicrotask(() => this.emit('error', denied))
      return this
    })
    const relay = createRelay()
    await expect(relay.start()).rejects.toBe(denied)
    expect(listen).toHaveBeenCalledTimes(1)
    expect(relay.webUrl()).toBeNull()
    await relay.start()
    expect(relay.webUrl()).not.toBeNull()
  })
})

describe('LocalMobileRelay reconnect', () => {
  it('routes a paired phone reconnect through its new socket after a page refresh', async () => {
    const handshake = { resolve: undefined as ((phone: string) => void) | undefined }
    const receivedHandshake = new Promise<string>(resolve => {
      handshake.resolve = resolve
    })
    const relay = new LocalMobileRelay(
      (id, frame) => {
        if (decodeType(frame) === FrameType.Handshake1) handshake.resolve?.(id)
      },
      () => {},
      '.',
    )
    relays.push(relay)
    await relay.start()

    const prepared = relay.prepare('refresh-test')
    expect(prepared).not.toBeNull()
    const url = new URL(prepared!.relay)
    url.hostname = '127.0.0.1'
    const first = await connect(url.toString())

    const key = toBase64Url(generateKeypair().publicKey)
    first.send(encodeFrame(FrameType.Pair, encodeJson({ key })))
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    const firstClosed = new Promise<void>(resolve => first.once('close', () => resolve()))
    first.close()
    await firstClosed

    const second = await connect(url.toString())
    const response = new Promise<Uint8Array>(resolve => {
      second.once('message', data => resolve(new Uint8Array(data as Buffer)))
    })
    second.send(encodeFrame(FrameType.Handshake1, Uint8Array.of(2)))

    const phone = await receivedHandshake
    expect(phone).toBe(localPhoneId(key))
    expect(relay.send(phone, encodeFrame(FrameType.Handshake2, Uint8Array.of(1)))).toBe(true)
    expect(decodeType(await response)).toBe(FrameType.Handshake2)
  })
})

function decodeType(frame: Uint8Array): number {
  return frame[0]
}
