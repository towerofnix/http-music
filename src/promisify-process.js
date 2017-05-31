'use strict'

module.exports = function promisifyProcess(proc, showLogging = true) {
  return new Promise((resolve, reject) => {
    if (showLogging) {
      proc.stdout.pipe(process.stdout)
      proc.stderr.pipe(process.stderr)
    }

    proc.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        console.error('Process failed!', proc.spawnargs)
        reject(code)
      }
    })
  })
}
