'use strict'

const { spawn } = require('child_process')
const FIFO = require('fifo-js')
const EventEmitter = require('events')
const { getDownloaderFor } = require('./downloaders')

class DownloadController extends EventEmitter {
  waitForDownload() {
    // Returns a promise that resolves when a download is
    // completed.  Note that this isn't necessarily the download
    // that was initiated immediately before a call to
    // waitForDownload (if any), since that download may have
    // been canceled (see cancel).  You can also listen for the
    // 'downloaded' event instead.

    return new Promise(resolve => {
      this.once('downloaded', file => resolve(file))
    })
  }

  async download(downloader, arg) {
    // Downloads a file.  This doesn't return anything; use
    // waitForDownload to get the result of this.
    // (The reasoning is that it's possible for a download to
    // be canceled and replaced with a new download (see cancel)
    // which would void the result of the old download.)

    this.cleanupListeners()

    let canceled = false

    this._handleCanceled = () => {
      canceled = true
      this.cleanupListeners()
    }

    this.once('canceled', this._handleCanceled)

    const file = await downloader(arg)

    if (!canceled) {
      this.emit('downloaded', file)
    }
  }

  cleanupListeners() {
    if (this._handleCanceled) {
      this.removeListener('canceled', this._handleCanceled)
    }
  }

  cancel() {
    // Cancels the current download.  This doesn't cancel any
    // waitForDownload promises, though -- you'll need to start
    // a new download to resolve those.

    this.emit('canceled')
    this.cleanupListeners()
  }
}

class PlayController {
  constructor(picker, downloadController) {
    this.currentTrack = null
    this.playArgs = []
    this.process = null
    this.picker = picker
    this.downloadController = downloadController
  }

  async loopPlay() {
    let nextFile

    // Null would imply there's NO up-next track, but really
    // we just haven't set it yet.
    this.nextTrack = undefined

    let downloadNext = () => {
      this.nextTrack = this.startNextDownload()
      if (this.nextTrack !== null) {
        return this.downloadController.waitForDownload().then(file => {
          nextFile = file
        })
      } else {
        nextFile = null
        return Promise.resolve()
      }
    }

    await downloadNext()

    while (this.nextTrack) {
      this.currentTrack = this.nextTrack
      await Promise.all([
        this.playFile(nextFile),
        downloadNext()
      ])
    }
  }

  startNextDownload() {
    // TODO: Handle/test null return from picker.
    const picked = this.picker()

    if (picked === null) {
      return null
    } else {
      const downloader = getDownloaderFor(picked.downloaderArg)
      this.downloadController.download(downloader, picked.downloaderArg)
      return picked
    }
  }

  async old_loopPlay() {
    // Playing music in a loop isn't particularly complicated; essentially, we
    // just want to keep picking and playing tracks until none is picked.

    let nextTrack = await this.picker()

    await this.downloadManager.download(getDownloaderFor(nextTrack), nextTrack)

    let downloadNext

    while (nextTrack) {
      this.currentTrack = nextTrack

      this.downloadManager.download(getDownloaderFor(nextTrack), nextTrack)

      await this.playFile(nextTrack[1])

      nextTrack = await this.picker()
    }
  }

  playFile(file) {
    this.fifo = new FIFO()
    this.process = spawn('mpv', [
      '--input-file=' + this.fifo.path,
      '--no-audio-display',
      file
    ])

    this.process.stderr.on('data', data => {
      const match = data.toString().match(
        /(..):(..):(..) \/ (..):(..):(..) \(([0-9]+)%\)/
      )

      if (match) {
        const [
          curHour, curMin, curSec, // ##:##:##
          lenHour, lenMin, lenSec, // ##:##:##
          percent // ###%
        ] = match.slice(1)

        let curStr, lenStr

        // We don't want to display hour counters if the total length is less
        // than an hour.
        if (parseInt(lenHour) > 0) {
          curStr = `${curHour}:${curMin}:${curSec}`
          lenStr = `${lenHour}:${lenMin}:${lenSec}`
        } else {
          curStr = `${curMin}:${curSec}`
          lenStr = `${lenMin}:${lenSec}`
        }

        // Multiplication casts to numbers; addition prioritizes strings.
        // Thanks, JavaScript!
        const curSecTotal = (3600 * curHour) + (60 * curMin) + (1 * curSec)
        const lenSecTotal = (3600 * lenHour) + (60 * lenMin) + (1 * lenSec)
        const percentVal = (100 / lenSecTotal) * curSecTotal
        const percentStr = (Math.trunc(percentVal * 100) / 100).toFixed(2)

        process.stdout.write(
          `\x1b[K~ (${percentStr}%) ${curStr} / ${lenStr}\r`
        )
      }
    })

    return new Promise(resolve => {
      this.process.once('close', resolve)
    })
  }

  skip() {
    this.kill()
  }

  seekAhead(secs) {
    this.sendCommand(`seek +${parseFloat(secs)}`)
  }

  seekBack(secs) {
    this.sendCommand(`seek -${parseFloat(secs)}`)
  }

  volUp(amount) {
    this.sendCommand(`add volume +${parseFloat(amount)}`)
  }

  volDown(amount) {
    this.sendCommand(`add volume -${parseFloat(amount)}`)
  }

  togglePause() {
    this.sendCommand('cycle pause')
  }

  sendCommand(command) {
    if (this.fifo) {
      this.fifo.write(command)
    }
  }

  kill() {
    if (this.process) {
      this.process.kill()
    }

    if (this.fifo) {
      this.fifo.close()
      delete this.fifo
    }

    this.currentTrack = null
  }

  logTrackInfo() {
    if (this.currentTrack) {
      const t = this.currentTrack
      console.log(`Playing: \x1b[1m${t.name} \x1b[2m${t.downloaderArg}\x1b[0m`)
    } else {
      console.log("No song currently playing.")
    }

    if (this.nextTrack) {
      const t = this.nextTrack
      console.log(`Up next: \x1b[1m${t.name} \x1b[2m${t.downloaderArg}\x1b[0m`)
    } else {
      console.log("No song up next.")
    }
  }
}

module.exports = function loopPlay(picker, playArgs = []) {
  // Looping play function. Takes one argument, the "picker" function,
  // which returns a track to play. Stops when the result of the picker
  // function is null (or similar). Optionally takes a second argument
  // used as arguments to the `play` process (before the file name).

  const downloadController = new DownloadController()
  const playController = new PlayController(picker, downloadController)
  playController.playArgs = playArgs

  const promise = playController.loopPlay()

  return {
    promise,
    playController,
    downloadController
  }
}
