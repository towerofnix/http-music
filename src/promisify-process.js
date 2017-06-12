'use strict'

const { Writable } = require('stream')

module.exports = function promisifyProcess(proc, showLogging = true) {
  // Takes a process (from the child_process module) and returns a promise
  // that resolves when the process exits (or rejects, if the exit code is
  // non-zero).

  return new Promise((resolve, reject) => {
    if (showLogging) {
      proc.stdout.pipe(process.stdout)
      proc.stderr.pipe(process.stderr)
    }

    proc.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(code)
      }
    })
  })
}
