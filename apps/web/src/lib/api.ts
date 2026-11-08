export const API = (import.meta.env?.VITE_API_URL as string | undefined) ?? ''

export async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(API + '/api/v1' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...init?.headers },
  })
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
