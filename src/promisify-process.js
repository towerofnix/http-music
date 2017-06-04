'use strict'

const { Writable } = require('stream')

module.exports = function promisifyProcess(proc, showLogging = true) {
  // Takes a process (from child_process) and returns a promise that resolves
  // when the process exits (or rejects with a warning, if the exit code is
  // non-zero).

  return new Promise((resolve, reject) => {
    if (showLogging) {
      proc.stdout.pipe(process.stdout)
      proc.stderr.pipe(process.stderr)
    } else {
      // For some mysterious reason, youtube-dl doesn't seem to work unless
      // we pipe the output of it SOMEWHERE..

      const emptyStream = () => Object.assign(new Writable(), {
        write: () => {}
      })

      proc.stdout.pipe(emptyStream())
      proc.stderr.pipe(emptyStream())
    }

    proc.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        console.error("Process failed!", proc.spawnargs)
        reject(code)
      }
    })
  })
}
