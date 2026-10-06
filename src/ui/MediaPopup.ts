/** The popup only needs one-shot key events; both game input systems implement this. */
interface PopupInput { consume(code: string): boolean }

export interface MediaPopupLink {
  label: string
  href: string
}

export interface MediaPopupContent {
  /** A YouTube link; plays across the top. Empty or missing shows `noVideoText` there instead. */
  video?: string
  /** Shown where the video would be when there is none. Null leaves the space out entirely. */
  noVideoText?: string | null
  title: string
  /** A short line under the title, in the accent colour. */
  subtitle?: string
  /** Paragraphs, or bullet points when `bulleted`. */
  body: readonly string[]
  bulleted?: boolean
  /** Buttons under the text. Links with an empty href are left out. */
  links: readonly MediaPopupLink[]
  /** Hex colour of the border, glow, subtitle and buttons. */
  accent: number
  /** Bottom-right key hint. */
  hint?: string
}

interface YouTubeVideo {
  id: string
  /** Seconds. */
  start: number
}

const YOUTUBE_ID = /^[\w-]{11}$/

/** Given this long to start playing with sound before it is muted - which browsers always let play. */
const SOUND_GRACE_MS = 1500

/** "90", "90s", "1m30s" or "1h2m3s" to whole seconds. */
function parseStartTime(value: string | null): number {
  if (!value) return 0
  if (/^\d+$/.test(value)) return Number(value)

  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value)
  if (!match) return 0
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0)
}

/** A YouTube link in any of its usual shapes - watch, youtu.be, shorts, live, embed - or null if it is not one. */
export function parseYouTube(link: string): YouTubeVideo | null {
  let url: URL
  try {
    url = new URL(link.trim())
  } catch {
    return null
  }

  const host = url.hostname.replace(/^(www\.|m\.)/, '')
  const segments = url.pathname.split('/').filter(Boolean)
  let id: string | undefined

  if (host === 'youtu.be') id = segments[0]
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (segments[0] === 'watch') id = url.searchParams.get('v') ?? undefined
    else if (['embed', 'shorts', 'live', 'v'].includes(segments[0])) id = segments[1]
  }

  if (!id || !YOUTUBE_ID.test(id)) return null
  return { id, start: parseStartTime(url.searchParams.get('t') ?? url.searchParams.get('start')) }
}

/* The slice of the YouTube IFrame Player API this uses. https://developers.google.com/youtube/iframe_api_reference */
interface YouTubePlayer {
  playVideo(): void
  mute(): void
  unMute(): void
  getPlayerState(): number
  destroy(): void
}

interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      host?: string
      videoId: string
      width?: string
      height?: string
      playerVars?: Record<string, number | string>
      events?: { onReady?: (event: { target: YouTubePlayer }) => void }
    },
  ) => YouTubePlayer
  PlayerState: { PLAYING: number; BUFFERING: number }
}

declare global {
  interface Window {
    YT?: YouTubeApi
    onYouTubeIframeAPIReady?: () => void
  }
}

let youTubeApi: Promise<YouTubeApi> | null = null

/** Loads the YouTube player API once, the first time a video is shown. */
function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT)

  youTubeApi ??= new Promise<YouTubeApi>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady
    window.onYouTubeIframeAPIReady = () => {
      previous?.()
      if (window.YT) resolve(window.YT)
    }

    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => {
      youTubeApi = null
      reject(new Error('The YouTube player API could not be loaded.'))
    }
    document.head.append(script)
  })

  return youTubeApi
}

/**
 * The big popup window used for both projects and experience: a video playing across the top, then a title,
 * a subtitle, text, and link buttons. E, Enter or Escape closes it, as do the close button and a click
 * outside the window - those two matter once the video has been clicked, because the video then has the
 * keyboard.
 *
 * Videos start with sound. Browsers only allow that once the visitor has interacted with the page, which in
 * this game they always have (they pressed E); if a browser still says no, the video plays muted instead of
 * sitting on its play button, and the visitor can unmute it.
 */
export class MediaPopup {
  private readonly root: HTMLDivElement
  private readonly window: HTMLDivElement
  private readonly closeButton: HTMLButtonElement
  private readonly media: HTMLDivElement
  private readonly title: HTMLHeadingElement
  private readonly subtitle: HTMLParagraphElement
  private readonly text: HTMLDivElement
  private readonly links: HTMLDivElement
  private readonly hint: HTMLSpanElement
  private readonly input: PopupInput
  private previousFocus: HTMLElement | null = null

  private onClose: (() => void) | undefined
  private player: YouTubePlayer | null = null
  private soundCheck: number | undefined
  /** Bumped on every open and close, so a video that finishes loading after its popup has gone is dropped. */
  private generation = 0

  constructor(parent: HTMLElement, input: PopupInput) {
    this.input = input

    this.root = document.createElement('div')
    this.root.className = 'media-popup'
    this.root.addEventListener('click', this.onBackdropClick)
    this.root.addEventListener('keydown', this.onKeyDown)

    this.window = document.createElement('div')
    this.window.className = 'media-popup-window'
    this.window.setAttribute('role', 'dialog')
    this.window.setAttribute('aria-modal', 'true')

    this.closeButton = document.createElement('button')
    this.closeButton.className = 'media-popup-close'
    this.closeButton.type = 'button'
    this.closeButton.textContent = '×'
    this.closeButton.setAttribute('aria-label', 'Close')
    this.closeButton.addEventListener('click', () => this.close())

    this.media = document.createElement('div')
    this.media.className = 'media-popup-media'

    const body = document.createElement('div')
    body.className = 'media-popup-body'

    this.title = document.createElement('h2')

    this.subtitle = document.createElement('p')
    this.subtitle.className = 'media-popup-subtitle'

    this.text = document.createElement('div')
    this.text.className = 'media-popup-text'

    this.links = document.createElement('div')
    this.links.className = 'media-popup-links'

    this.hint = document.createElement('span')
    this.hint.className = 'media-popup-hint'

    body.append(this.title, this.subtitle, this.text, this.links, this.hint)
    this.window.append(this.closeButton, this.media, body)
    this.root.append(this.window)
    parent.append(this.root)
  }

  get isOpen(): boolean {
    return this.root.classList.contains('open')
  }

  open(content: MediaPopupContent, onClose?: () => void): void {
    this.stopVideo()
    this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const generation = ++this.generation
    this.onClose = onClose
    this.window.style.setProperty('--popup-accent', `#${content.accent.toString(16).padStart(6, '0')}`)

    const video = content.video ? parseYouTube(content.video) : null
    const noVideoText = content.video ? 'That video link is not a YouTube video' : content.noVideoText
    this.media.hidden = !video && noVideoText === null

    if (video) {
      this.showVideo(video, generation)
    } else if (noVideoText !== null) {
      const placeholder = document.createElement('div')
      placeholder.className = 'media-popup-placeholder'
      placeholder.textContent = noVideoText ?? 'Video coming soon'
      this.media.replaceChildren(placeholder)
    }

    this.title.textContent = content.title
    this.subtitle.textContent = content.subtitle ?? ''
    this.subtitle.hidden = !content.subtitle

    const paragraphs = content.body.filter((line) => line.trim().length > 0)
    if (content.bulleted) {
      const list = document.createElement('ul')
      for (const line of paragraphs) {
        const item = document.createElement('li')
        item.textContent = line
        list.append(item)
      }
      this.text.replaceChildren(list)
    } else {
      this.text.replaceChildren(...paragraphs.map((line) => {
        const paragraph = document.createElement('p')
        paragraph.textContent = line
        return paragraph
      }))
    }
    this.text.hidden = paragraphs.length === 0

    const buttons = content.links.filter((link) => link.href.trim().length > 0).map((link) => {
      const anchor = document.createElement('a')
      anchor.className = 'media-popup-link'
      anchor.textContent = link.label
      anchor.href = link.href.trim()
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
      return anchor
    })
    this.links.replaceChildren(...buttons)
    this.links.hidden = buttons.length === 0

    this.hint.textContent = content.hint ?? '[E] Close'
    this.root.classList.add('open')
    this.closeButton.focus({ preventScroll: true })
  }

  close(): void {
    if (!this.isOpen) return
    this.root.classList.remove('open')
    this.generation++

    // Taking the player out stops the video, and hands the keyboard back to the game if it had it.
    this.stopVideo()

    const target = this.previousFocus?.isConnected && this.previousFocus !== document.body
      ? this.previousFocus
      : document.querySelector<HTMLCanvasElement>('canvas')
    target?.focus({ preventScroll: true })
    this.previousFocus = null

    const callback = this.onClose
    this.onClose = undefined
    callback?.()
  }

  update(): void {
    if (!this.isOpen) return
    if (this.input.consume('Escape') || this.input.consume('KeyE') || this.input.consume('Enter')) this.close()
  }

  dispose(): void {
    this.generation++
    this.stopVideo()
    this.root.removeEventListener('click', this.onBackdropClick)
    this.root.removeEventListener('keydown', this.onKeyDown)
    this.root.remove()
  }

  private showVideo(video: YouTubeVideo, generation: number): void {
    // The player API swaps this element for its iframe.
    const mount = document.createElement('div')
    this.media.replaceChildren(mount)

    loadYouTubeApi()
      .then((api) => {
        if (generation !== this.generation) return

        this.player = new api.Player(mount, {
          host: 'https://www.youtube-nocookie.com',
          videoId: video.id,
          width: '100%',
          height: '100%',
          playerVars: {
            autoplay: 1,
            playsinline: 1,
            rel: 0,
            // A single video only loops when it is also its own playlist.
            loop: 1,
            playlist: video.id,
            ...(video.start > 0 ? { start: video.start } : {}),
          },
          events: {
            onReady: ({ target }) => {
              if (generation !== this.generation) return
              target.unMute()
              target.playVideo()

              // Not playing by now means the browser refused sound: play it muted rather than not at all.
              this.soundCheck = window.setTimeout(() => {
                if (generation !== this.generation) return
                const state = target.getPlayerState()
                if (state !== api.PlayerState.PLAYING && state !== api.PlayerState.BUFFERING) {
                  target.mute()
                  target.playVideo()
                }
              }, SOUND_GRACE_MS)
            },
          },
        })
      })
      .catch(() => {
        if (generation !== this.generation) return

        // No player API (blocked or offline): a plain embed, asking for sound.
        const frame = document.createElement('iframe')
        const params = new URLSearchParams({ autoplay: '1', playsinline: '1', rel: '0', loop: '1', playlist: video.id })
        if (video.start > 0) params.set('start', String(video.start))
        frame.src = `https://www.youtube-nocookie.com/embed/${video.id}?${params}`
        frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
        frame.allowFullscreen = true
        frame.referrerPolicy = 'strict-origin-when-cross-origin'
        this.media.replaceChildren(frame)
      })
  }

  private stopVideo(): void {
    window.clearTimeout(this.soundCheck)
    this.soundCheck = undefined
    this.player?.destroy()
    this.player = null
    this.media.replaceChildren()
  }

  private readonly onBackdropClick = (event: MouseEvent): void => {
    if (event.target === this.root) this.close()
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'KeyE' || event.code === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      this.close()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...this.window.querySelectorAll<HTMLElement>('button, a[href], iframe')]
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
}
