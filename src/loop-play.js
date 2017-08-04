// This isn't actually the code for the `play` command! That's in `play.js`.

'use strict'

const { spawn } = require('child_process')
const FIFO = require('fifo-js')
const EventEmitter = require('events')
const {
  getDownloaderFor, makeConverterDownloader,
  byName: downloadersByName
} = require('./downloaders')
const { getItemPathString } = require('./playlist-utils')
const promisifyProcess = require('./promisify-process')

class DownloadController extends EventEmitter {
  waitForDownload() {
    // Returns a promise that resolves when a download is
    // completed.  Note that this isn't necessarily the download
    // that was initiated immediately before a call to
    // waitForDownload (if any), since that download may have
    // been canceled (see cancel).  You can also listen for the
    // 'downloaded' event instead.

    return new Promise((resolve, reject) => {
      const onDownloaded = file => { clear(); resolve(file) }
      const onErrored = err => { clear(); reject(err) }

      const clear = () => {
        this.removeListener('downloaded', onDownloaded)
        this.removeListener('errored', onErrored)
      }

      this.once('downloaded', onDownloaded)
      this.once('errored', onErrored)
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

    let file

    try {
      file = await downloader(arg)
    } catch(err) {
      this.emit('errored', err)
      return
    }

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
    this.picker = picker
    this.downloadController = downloadController
    this.playOpts = []
    this.playerCommand = null
    this.currentTrack = null
    this.process = null
  }

  async loopPlay() {
    let nextFile

    // Null would imply there's NO up-next track, but really we just haven't
    // set it yet.
    this.nextTrack = undefined

    const downloadNext = async () => {
      this.nextTrack = this.startNextDownload()
      if (this.nextTrack !== null) {
        try {
          nextFile = await this.downloadController.waitForDownload()
        } catch(err) {
          console.warn(
            "\x1b[31mFailed to download (or convert) track \x1b[1m" +
            getItemPathString(this.nextTrack) + "\x1b[0m"
          )
          await downloadNext()
        }
      } else {
        nextFile = null
      }
    }

    await downloadNext()

    while (this.nextTrack) {
      this.currentTrack = this.nextTrack

      await Promise.all([
        // If the downloader returns false, the file failed to download; that
        // means we'll just skip this track and wait for the next.
        nextFile !== false ? this.playFile(nextFile) : Promise.resolve(),
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
      let downloader

      if (picked.downloader) {
        downloader = downloadersByName[picked.downloader]()

        if (!downloader) {
          console.error(
            `Invalid downloader for track ${picked.name}:`, downloader
          )

          return false
        }
      } else {
        downloader = getDownloaderFor(picked.downloaderArg)
      }

      downloader = makeConverterDownloader(downloader, 'wav')
      this.downloadController.download(downloader, picked.downloaderArg)
      return picked
    }
  }

  playFile(file) {
    if (this.playerCommand === 'sox' || this.playerCommand === 'play') {
      return this.playFileSoX(file)
    } else if (this.playerCommand === 'mpv') {
      return this.playFileMPV(file)
    } else {
      if (this.playerCommand) {
        console.warn('Invalid player command given?', this.playerCommand)
      } else {
        console.warn('No player command given?')
      }

      return Promise.resolve()
    }
  }

  playFileSoX(file) {
    // SoX's play command is useful for systems that don't have MPV. SoX is
    // much easier to install (and probably more commonly installed, as well).
    // You don't get keyboard controls such as seeking or volume adjusting
    // with SoX, though.

    this.process = spawn('play', [
      ...this.playOpts,
      file
    ])

    return promisifyProcess(this.process)
  }

  playFileMPV(file) {
    // The more powerful MPV player. MPV is virtually impossible for a human
    // being to install; if you're having trouble with it, try the SoX player.

    this.fifo = new FIFO()
    this.process = spawn('mpv', [
      '--input-file=' + this.fifo.path,
      '--no-audio-display',
      file,
      ...this.playOpts
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
    if (this.playerCommand === 'mpv' && this.fifo) {
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
    const getMessage = t => {
      let path = getItemPathString(t)

      return (
        `\x1b[1m${t.name} \x1b[0m@ ${path} \x1b[2m${t.downloaderArg}\x1b[0m`
      )
    }

    if (this.currentTrack) {
      console.log(`Playing: ${getMessage(this.currentTrack)}`)
    } else {
      console.log("No song currently playing.")
    }

    if (this.nextTrack) {
      console.log(`Up next: ${getMessage(this.nextTrack)}`)
    } else {
      console.log("No song up next.")
    }
  }
}

module.exports = function loopPlay(
  picker, playerCommand = 'mpv', playOpts = []
) {
  // Looping play function. Takes one argument, the "picker" function,
  // which returns a track to play. Stops when the result of the picker
  // function is null (or similar). Optionally takes a second argument
  // used as arguments to the `play` process (before the file name).

  const downloadController = new DownloadController()

  const playController = new PlayController(picker, downloadController)

  Object.assign(playController, {playerCommand, playOpts})

  const promise = playController.loopPlay()

  return {
    promise,
    playController,
    downloadController
  }
}
