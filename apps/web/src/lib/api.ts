export const API = (import.meta.env?.VITE_API_URL as string | undefined) ?? ''

/**
 * Sends a JSON API request. Content-Type is only set when a body is present:
 * a DELETE or empty POST carrying "application/json" with no body makes
 * Fastify reject the request with 400 INVALID_INPUT.
 */
export async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body !== undefined && init?.body !== null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) headers.set('Authorization', 'Bearer ' + token)
  const response = await fetch(API + '/api/v1' + path, { ...init, headers })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const message = body.message || body.error?.message || body.error || '请求失败 (' + response.status + ')'
    const error = new Error(typeof message === 'string' ? message : '请求失败 (' + response.status + ')') as Error & { status?: number; code?: string }
    error.status = response.status
    error.code = body.error?.code
    throw error
  }
  return response.status === 204 ? (undefined as T) : response.json()
}
