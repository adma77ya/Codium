// Single place that knows where the API lives and how to authenticate.
// Default is localhost:8080, reached through an SSH tunnel to EC2, so port 8080
// never has to be opened to the internet during development.
// In a production build the site and API share one origin (nginx proxies /api and /ws).
export const API_BASE: string =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8080' : window.location.origin)
export const WS_BASE = API_BASE.replace(/^http/, 'ws')

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

interface Opts {
  method?: string
  body?: unknown
  token?: string | null
  signal?: AbortSignal
}

export async function call<T>(path: string, { method = 'GET', body, token, signal }: Opts = {}): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method,
    signal,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`)
  return data as T
}
