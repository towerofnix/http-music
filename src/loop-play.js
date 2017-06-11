'use strict'

const { spawn } = require('child_process')
const promisifyProcess = require('./promisify-process')
const sanitize = require('sanitize-filename')
const tempy = require('tempy')

class DownloadController {
  constructor(picker, downloader) {
    this.process = null

    this.picker = picker
    this.downloader = downloader
  }

  async downloadNext() {
    const picked = this.picker()

    if (picked == null) {
      return false
    }

    const [ title, downloaderArg ] = picked
    console.log(`Downloading ${title}..\nDownloader arg: ${downloaderArg}`)

    const from = await this.downloader(downloaderArg)

    const tempDir = tempy.directory()
    const to = tempDir + `/.${sanitize(title)}.wav`

    // We pass false to promisifyProcess to show we want hte output of avconv
    // to be silenced.
    const convertProcess = spawn('avconv', ['-y', '-i', from, to])
    const convertPromise = promisifyProcess(convertProcess, false)

    this.wavFile = to
    this.process = convertProcess

    try {
      await convertPromise
    } catch(err) {
      console.warn("Failed to convert " + title)
      console.warn("Selecting a new track\n")

      this.killProcess()

      return await this.downloadNext()
    }
  }

  killProcess() {
    if (this.process) {
      this.process.kill()
    }
  }
}

class PlayController {
  constructor(downloadController) {
    this.playArgs = []
    this.process = null

    this.downloadController = downloadController
  }

  async loopPlay() {
    await this.downloadController.downloadNext()

    while (this.downloadController.wavFile) {
      const nextPromise = this.downloadController.downloadNext()

      const file = this.downloadController.wavFile
      const playProcess = spawn('play', [...this.playArgs, file])
      const playPromise = promisifyProcess(playProcess)
      this.process = playProcess

      try {
        await playPromise
      } catch(err) {
        console.warn(err)
      }

      await nextPromise
    }
  }

  killProcess() {
    if (this.process) {
      this.process.kill()
    }
  }
}

module.exports = function loopPlay(picker, downloader, playArgs = []) {
  // Looping play function. Takes one argument, the "pick" function,
  // which returns a track to play. Preemptively downloads the next
  // track while the current one is playing for seamless continuation
  // from one song to the next. Stops when the result of the pick
  // function is null (or similar). Optionally takes a second argument
  // used as arguments to the `play` process (before the file name).

  const downloadController = new DownloadController(picker, downloader)

  const playController = new PlayController(downloadController)
  playController.playArgs = playArgs

  const promise = playController.loopPlay()

  return {
    promise,

    skip: function() {
      playController.killProcess()
    },

    kill: function() {
      playController.killProcess()
      downloadController.killProcess()
    }
  }
}
