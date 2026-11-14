import type { PGLiteSocketServer } from '@electric-sql/pglite-socket'

/**
 * The connection string for a socket server that was started on an OS-assigned port.
 *
 * Every suite used to hard-code its port (5599, 5601, 5603, 5611, 5613). That works
 * until two runs overlap, or a killed process lingers with the listening socket
 * still open: the next run then dies with EADDRINUSE before a single assertion, and
 * a suite that "hangs" is much harder to read than one that fails. Binding to port 0
 * and asking the server what it got removes the shared resource entirely.
 *
 * `getServerConn()` already returns the full connection string, so this only adds
 * the password the server does not know about.
 */
export function socketUrl(server: PGLiteSocketServer, host = '127.0.0.1'): string {
  const assigned = server.getServerConn()
  const port = /:(\d+)$/.exec(assigned)?.[1]
  if (!port) throw new Error('socket server did not report a port: ' + assigned)
  return 'postgresql://postgres:postgres@' + host + ':' + port + '/postgres'
}

/**
 * Tears a suite down without letting one stuck handle hold the process open.
 *
 * `node --test` waits for the event loop to drain, so a pool that never finishes
 * `end()` - or a socket server whose last connection is still attached - turns a
 * file where every assertion passed into a run that never exits and is reported as
 * a timeout. The assertion results are already printed by then; what is missing is
 * the process exit, which reads like a hang in the code under test.
 *
 * Each close is therefore time-boxed. Five seconds is far longer than any of these
 * take when they work, and the warning names which one did not.
 */
export async function settle(label: string, work: Promise<unknown> | undefined | null, timeoutMs = 5000): Promise<void> {
  if (!work) return
  let timer: NodeJS.Timeout | undefined
  const guard = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn('teardown: ' + label + ' did not finish in ' + timeoutMs + 'ms')
      resolve()
    }, timeoutMs)
    timer.unref?.()
  })
  try {
    await Promise.race([Promise.resolve(work).catch(() => undefined), guard])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
