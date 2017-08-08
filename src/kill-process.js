'use strict'

const { spawn } = require('child_process')
const commandExists = require('./command-exists')
const promisifyProcess = require('./promisify-process')

module.exports = async function killProcess(proc) {
  // Windows is stupid and doesn't like it when we try to kill processes.
  // So instead we use taskkill! https://stackoverflow.com/a/28163919/4633828

  if (await commandExists('taskkill')) {
    await promisifyProcess(
      spawn('taskkill', ['/pid', proc.pid, '/f', '/t']),
      false
    )
  } else {
    proc.kill()
  }
}
