export type NetworkStatus = 'offline' | 'connecting' | 'online'

export interface NetworkMessage {
  type: string
  payload?: unknown
}

type Listener<T> = (value: T) => void

const INITIAL_RETRY_MS = 1000
const MAX_RETRY_MS = 15000

/**
 * An optional WebSocket connection to a presence or multiplayer server.
 *
 * Nothing connects unless connect() is called, so the game runs entirely offline by default. Drops
 * are retried with exponential backoff; disconnect() stops retrying.
 */
export class NetworkSystem {
  private socket: WebSocket | null = null
  private url: string | null = null
  private currentStatus: NetworkStatus = 'offline'
  private retryDelay = INITIAL_RETRY_MS
  private retryTimer: number | undefined
  private readonly statusListeners = new Set<Listener<NetworkStatus>>()
  private readonly messageListeners = new Set<Listener<NetworkMessage>>()

  get status(): NetworkStatus {
    return this.currentStatus
  }

  /** Returns a function that removes the listener. */
  onStatus(listener: Listener<NetworkStatus>): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  /** Returns a function that removes the listener. */
  onMessage(listener: Listener<NetworkMessage>): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  connect(url: string): void {
    this.disconnect()
    this.url = url
    this.retryDelay = INITIAL_RETRY_MS
    this.open()
  }

  disconnect(): void {
    this.url = null
    window.clearTimeout(this.retryTimer)
    this.retryTimer = undefined

    const socket = this.socket
    this.socket = null
    if (socket) socket.close()

    this.setStatus('offline')
  }

  /** Returns false when there is no open connection to send on. */
  send(message: NetworkMessage): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(message))
    return true
  }

  dispose(): void {
    this.disconnect()
    this.statusListeners.clear()
    this.messageListeners.clear()
  }

  private open(): void {
    if (!this.url) return
    this.setStatus('connecting')

    let socket: WebSocket
    try {
      socket = new WebSocket(this.url)
    } catch (error) {
      // A malformed URL throws synchronously. Retrying the same URL would never succeed.
      console.warn(`[NetworkSystem] Cannot connect to '${this.url}':`, error)
      this.url = null
      this.setStatus('offline')
      return
    }

    this.socket = socket

    socket.onopen = () => {
      this.retryDelay = INITIAL_RETRY_MS
      this.setStatus('online')
    }

    socket.onmessage = (event) => {
      const message = this.parse(event.data)
      if (!message) return
      for (const listener of this.messageListeners) listener(message)
    }

    socket.onclose = () => {
      // Ignore a socket that has already been replaced or deliberately closed.
      if (this.socket !== socket) return
      this.socket = null
      this.setStatus('offline')
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect(): void {
    if (!this.url) return
    this.retryTimer = window.setTimeout(() => this.open(), this.retryDelay)
    this.retryDelay = Math.min(this.retryDelay * 2, MAX_RETRY_MS)
  }

  private parse(data: unknown): NetworkMessage | null {
    if (typeof data !== 'string') return null

    try {
      const parsed: unknown = JSON.parse(data)
      if (typeof parsed === 'object' && parsed !== null && typeof (parsed as { type?: unknown }).type === 'string') {
        return parsed as NetworkMessage
      }
    } catch {
      // Not JSON - fall through.
    }

    console.warn('[NetworkSystem] Ignored a message that is not { type, payload } JSON.')
    return null
  }

  private setStatus(next: NetworkStatus): void {
    if (this.currentStatus === next) return
    this.currentStatus = next
    for (const listener of this.statusListeners) listener(next)
  }
}
