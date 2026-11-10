import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

export async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const key = await scrypt(password, salt, 64) as Buffer
  return `scrypt:${salt}:${key.toString('hex')}`
}

export async function passwordMatches(password: string, encoded: string): Promise<boolean> {
  const [, salt, expectedHex] = encoded.split(':')
  if (!salt || !expectedHex) return false
  const actual = await scrypt(password, salt, 64) as Buffer
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Strips the password hash and internal columns before a user leaves the API. */
export function safeUser(row: { id: string; email: string; name: string; role: 'admin' | 'member' }) {
  return { id: row.id, email: row.email, name: row.name, role: row.role }
}
