import { afterEach, describe, expect, it } from 'vitest'
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
})

function connect(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url, bridgeProtocols('local.refresh-test'))
  clients.push(socket)
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(socket))
    socket.once('error', reject)
  })
}

describe('LocalMobileRelay reconnect', () => {
  it('routes a paired phone reconnect through its new socket after a page refresh', async () => {
    let relay: LocalMobileRelay
    let phone = ''
    let handshakeResponse = (_sent: boolean) => {}
    const responseSent = new Promise<boolean>(resolve => {
      handshakeResponse = resolve
    })
    relay = new LocalMobileRelay(
      (id, frame) => {
        if (decodeType(frame) === FrameType.Handshake1)
          handshakeResponse(relay.send(id, encodeFrame(FrameType.Handshake2, Uint8Array.of(1))))
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
    phone = localPhoneId(key)
    first.send(encodeFrame(FrameType.Pair, encodeJson({ key })))
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    const firstClosed = new Promise<void>(resolve => first.once('close', () => resolve()))
    first.close()
    await firstClosed

    const second = await connect(url.toString())
    second.send(encodeFrame(FrameType.Handshake1, Uint8Array.of(2)))

    await expect(responseSent).resolves.toBe(true)
    expect(phone).toBe(localPhoneId(key))
  })
})

function decodeType(frame: Uint8Array): number {
  return frame[0]
}
