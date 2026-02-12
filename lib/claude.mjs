import { spawn } from 'node:child_process'

// Runs `claude -p` with input text, returns stdout.
// Rejects on timeout or non-zero exit.
export function runClaude(cmd, inputText, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0], cmd.slice(1), {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => {
      stdout += d
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Timed out after ${timeoutMs / 1000}s`))
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        reject(new Error(`Exit ${code}: ${stderr.slice(0, 500)}`))
      } else {
        resolve(stdout)
      }
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    // Ignore EPIPE — child may exit before reading stdin
    child.stdin.on('error', () => {})
    child.stdin.write(inputText)
    child.stdin.end()
  })
}
