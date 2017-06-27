'use strict'

const { spawn } = require('child_process')
const promisifyProcess = require('./promisify-process')
const sanitize = require('sanitize-filename')
const tempy = require('tempy')
const path = require('path')

const FIFO = require('fifo-js')

const EventEmitter = require('events')

class DownloadController extends EventEmitter {
  constructor(picker, downloader) {
    super()

    this.pickedTrack = null
    this.process = null
    this.isDownloading = false

    this.picker = picker
    this.downloader = downloader

    this._downloadNext = null
  }

  downloadNext() {
    this.downloadNextHelper()

    return new Promise(resolve => {
      this.once('downloadFinished', resolve)
    })
  }

  async downloadNextHelper() {
    this.isDownloading = true

    const destroyedObj = {wasDestroyed: false}

    this._destroyDownload = () => {
      destroyedObj.wasDestroyed = true
    }

    // We need to actually pick something to download; we'll use the picker
    // (given in the DownloadController constructor) for that.
    // (See pickers.js.)
    const picked = this.picker()

    // If the picker returns null, nothing was picked; that means that we
    // should stop now. No point in trying to play nothing!
    if (picked == null) {
      this.playFile = null
      return false
    }

    // Having the picked song being available is handy, for UI stuff (i.e. for
    // being displayed to the user through the console).
    this.pickedTrack = picked
    this.emit('trackPicked', picked)

    // The picked result is an array containing the title of the track (only
    // really used to display to the user) and an argument to be passed to the
    // downloader. The downloader argument doesn't have to be anything in
    // particular; but typically it's a string containing a URL or file path.
    // It's up to the downloader to decide what to do with it.
    const [ title, downloaderArg ] = picked

    // The "from" file is downloaded by the downloader (given in the
    // DownloadController constructor) using the downloader argument we just
    // got.
    const fromFile = await this.downloader(downloaderArg)

    // Ignore the '.' at the start.
    const format = path.extname(fromFile).slice(1)

    // We'll only want to convert the "from" file if it's not already supported
    // by SoX; so we check the supported format list.

    const supportedFormats = await this.getSupportedFormats()

    if (supportedFormats.includes(format)) {
      this.playFile = fromFile
    } else {
      this.playFile = await this.convert(picked, fromFile, destroyedObj)
    }

    // If this download was destroyed, we quit now; we don't want to emit that
    // the download was finished if the finished download was the destroyed
    // one!
    if (destroyedObj.wasDestroyed) {
      return
    }

    this.emit('downloadFinished')
  }

  async getSupportedFormats() {
    // TODO: This is irrelevant with `mpv` instead of `play`.

    // Gets the formats supported by SoX (i.e., the `play` command) by
    // searching the help output for the line that starts with
    // 'AUDIO FILE FORMATS:'. This seems to be the only way to list the formats
    // that any installation of SoX accepts; in the documentation, this is also
    // the recommended way (though it's not particularly suggested to be parsed
    // automatically): "To see if SoX has support for an optional format or
    // device, enter sox −h and look for its name under the list: 'AUDIO FILE
    // FORMATS' or 'AUDIO DEVICE DRIVERS'."

    if (this._supportedSoXFormats) {
      return this._supportedSoXFormats
    }

    const sox = spawn('sox', ['-h'])

    const buffers = []

    sox.stdout.on('data', buf => {
      buffers.push(buf)
    })

    await promisifyProcess(sox, false)

    const str = Buffer.concat(buffers).toString()

    const lines = str.split('\n')

    const prefix = 'AUDIO FILE FORMATS: '

    const formatsLine = lines.find(line => line.startsWith(prefix))

    const formats = formatsLine.slice(prefix.length).split(' ')

    this._supportedSoXFormats = formats

    return formats
  }

  async convert(picked, fromFile, destroyedObj) {
    // The "to" file is simply an MP3 file. We give this MP3 file a specific
    // name - the title of the track we got earlier, sanitized to be file-safe
    // - so that when `play` outputs the name of the song, it's obvious to the
    // user what's being played.
    //
    // Previously a WAV file was used here. Converting to a WAV file is
    // considerably faster than converting to an MP3; however, the file sizes
    // of WAVs tend to be drastically larger than MP3s. When saving disk space
    // is one of the greatest concerns (it's essentially the point of
    // http-music!), it's better to opt for an MP3. Additionally, most audio
    // convertion is done in the background, while another track is already
    // playing, so an extra few seconds of background time can hardly be
    // noticed.
    const title = picked[1]
    const tempDir = tempy.directory()
    const toFile = tempDir + `/.${sanitize(title)}.mp3`

    // Now that we've got the `to` and `from` file names, we can actually do
    // the convertion. We don't want any output from `avconv` at all, since the
    // output of `play` will usually be displayed while `avconv` is running,
    // so we pass `-loglevel quiet` into `avconv`.
    const convertProcess = spawn('avconv', [
      '-loglevel', 'quiet', '-i', fromFile, toFile
    ])

    // We store the convert process so that we can kill it before it finishes,
    // if that's most convenient (e.g. if skipping the current song or quitting
    // the entire program).
    this.process = convertProcess

    // Now it's only a matter of time before the process is finished.
    // Literally; we need to await the promisified version of our convertion
    // child process.
    try {
      await promisifyProcess(convertProcess)
    } catch(err) {
      // There's a chance we'll fail, though. That could happen if the passed
      // "from" file doesn't actually contain audio data. In that case, we
      // have to attempt this whole process over again, so that we get a
      // different file. (Technically, the picker might always pick the same
      // file; if that's the case, and the convert process is failing on it,
      // we could end up in an infinite loop. That would be bad, since there
      // isn't any guarding against a situation like that here.)

      // Usually we'll log a warning message saying that the convertion failed,
      // but if this download was destroyed, it's expected for the avconv
      // process to fail; so in that case we don't bother warning the user.
      if (!destroyedObj.wasDestroyed) {
        console.warn("Failed to convert " + title)
        console.warn("Selecting a new track")

        return await this.downloadNext()
      }
    }

    return toFile
  }

  skipUpNext() {
    if (this._destroyDownload) {
      this._destroyDownload()
    }

    this.downloadNextHelper()
  }

  killProcess() {
    if (this.process) {
      this.process.kill()
    }
  }
}

class PlayController {
  constructor(downloadController) {
    this.currentTrack = null
    this.upNextTrack = null
    this.playArgs = []
    this.process = null

    this.downloadController = downloadController

    this.downloadController.on('trackPicked', track => {
      this.upNextTrack = track
    })
  }

  async loopPlay() {
    // Playing music in a loop isn't particularly complicated; essentially, we
    // just want to keep downloading and playing tracks until none is picked.

    await this.downloadController.downloadNext()

    while (this.downloadController.playFile) {
      this.currentTrack = this.downloadController.pickedTrack

      await this.playFile(this.downloadController.playFile)

      await this.downloadController.downloadNext()
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

  skipCurrent() {
    this.killProcess()
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

  killProcess() {
    if (this.process) {
      this.process.kill()
    }

    if (this.fifo) {
      this.fifo.close()
      delete this.fifo
    }

    this.currentTrack = null
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

    seekBack: secs => playController.seekBack(secs),
    seekAhead: secs => playController.seekAhead(secs),
    skipCurrent: () => playController.skipCurrent(),
    skipUpNext: () => downloadController.skipUpNext(),
    volUp: amount => playController.volUp(amount),
    volDown: amount => playController.volDown(amount),
    togglePause: () => playController.togglePause(),

    kill: function() {
      playController.killProcess()
      downloadController.killProcess()
    },

    logTrackInfo: function() {
      if (playController.currentTrack) {
        const [ curTitle, curArg ] = playController.currentTrack
        console.log(`Playing: \x1b[1m${curTitle} \x1b[2m${curArg}\x1b[0m`)
      } else {
        console.log("No song currently playing.")
      }

      if (playController.upNextTrack) {
        const [ nextTitle, nextArg ] = playController.upNextTrack
        console.log(`Up next: \x1b[1m${nextTitle} \x1b[2m${nextArg}\x1b[0m`)
      } else {
        console.log("No song up next.")
      }
    }
  }
}
