// This isn't actually the code for the `play` command! That's in `play.js`.

// NOTE TO FUTURE SELF AND READERS:
// Please be careful to discern the target of methods such as waitForDownload.
// DownloadController and PlayController are messes and have lots of functions
// of the same name but completely different purposes. (Also keep an eye out
// for similarly/identically-named events between the two classes.)

'use strict'

const { spawn } = require('child_process')
const FIFO = require('fifo-js')
const EventEmitter = require('events')
const promisifyProcess = require('./promisify-process')
const killProcess = require('./kill-process')
const { getItemPathString, safeUnlink } = require('./playlist-utils')
const { HistoryController, generalPicker } = require('./pickers2')

const {
  getDownloaderFor, byName: downloadersByName, makeConverter
} = require('./downloaders')

class Player {
  constructor() {
    this.disablePlaybackStatus = false
  }

  playFile(file) {}
  seekAhead(secs) {}
  seekBack(secs) {}
  volUp(amount) {}
  volDown(amount) {}
  togglePause() {}
  kill() {}
}

class MPVPlayer extends Player {
  getMPVOptions(file) {
    return ['--no-audio-display', file]
  }

  playFile(file) {
    // The more powerful MPV player. MPV is virtually impossible for a human
    // being to install; if you're having trouble with it, try the SoX player.

    this.process = spawn('mpv', this.getMPVOptions(file))

    this.process.stderr.on('data', data => {
      if (this.disablePlaybackStatus) {
        return
      }

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

  async kill() {
    if (this.process) {
      await killProcess(this.process)
    }
  }
}

class ControllableMPVPlayer extends MPVPlayer {
  getMPVOptions(file) {
    return ['--input-file=' + this.fifo.path, ...super.getMPVOptions(file)]
  }

  playFile(file) {
    this.fifo = new FIFO()

    return super.playFile(file)
  }

  sendCommand(command) {
    if (this.fifo) {
      this.fifo.write(command)
    }
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

  kill() {
    if (this.fifo) {
      this.fifo.close()
      delete this.fifo
    }

    return super.kill()
  }
}

class SoXPlayer extends Player {
  playFile(file) {
    // SoX's play command is useful for systems that don't have MPV. SoX is
    // much easier to install (and probably more commonly installed, as well).
    // You don't get keyboard controls such as seeking or volume adjusting
    // with SoX, though.

    this.process = spawn('play', [file])

    this.process.stdout.on('data', data => {
      process.stdout.write(data.toString())
    })

    // Most output from SoX is given to stderr, for some reason!
    this.process.stderr.on('data', data => {
      // The status line starts with "In:".
      if (data.toString().trim().startsWith('In:')) {
        if (this.disablePlaybackStatus) {
          return
        }
      }

      process.stdout.write(data.toString())
    })

    return new Promise(resolve => {
      this.process.on('close', () => resolve())
    })
  }

  async kill() {
    if (this.process) {
      await killProcess(this.process)
    }
  }
}

class DownloadController extends EventEmitter {
  constructor(playlist) {
    super()

    this.playlist = playlist
  }

  async init() {
    this.converter = await makeConverter('wav')
  }

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
    // The resulting file is a WAV.

    this.cleanupListeners()

    let canceled = false

    this._handleCanceled = () => {
      canceled = true
      this.cleanupListeners()
    }

    this.once('canceled', this._handleCanceled)

    let downloadFile

    // TODO: Be more specific; 'errored' * 2 could instead be 'downloadErrored' and
    // 'convertErrored'.

    try {
      downloadFile = await downloader(arg)
    } catch(err) {
      this.emit('errored', err)
      return
    }

    // If this current download has been canceled, we should get rid of the
    // download file (and shouldn't emit a download success).
    if (canceled) {
      await safeUnlink(downloadFile, this.playlist)
      return
    }

    let convertFile

    try {
      convertFile = await this.converter(downloadFile)
    } catch(err) {
      this.emit('errored', err)
      return
    } finally {
      // Whether the convertion succeeds or not (hence 'finally'), we should
      // delete the temporary download file.
      await safeUnlink(downloadFile, this.playlist)
    }

    // Again, if canceled, we should delete temporary files and stop.
    if (canceled) {
      await safeUnlink(convertFile, this.playlist)
      return
    }

    this.emit('downloaded', convertFile)
    this.cleanupListeners()
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

class PlayController extends EventEmitter {
  constructor(player, playlist, historyController, downloadController) {
    super()

    this.player = player
    this.playlist = playlist
    this.historyController = historyController
    this.downloadController = downloadController

    this.currentTrack = null
    this.nextTrack = null
    this.nextFile = undefined // TODO: Why isn't this null?
    this.stopped = false
  }

  async loopPlay() {
    // Null would imply there's NO up-next track, but really we just haven't
    // set it yet.
    this.nextTrack = undefined

    this.startNextDownload()

    await this.waitForDownload()

    while (this.nextTrack && !this.stopped) {
      this.currentTrack = this.nextTrack

      const next = this.nextFile
      this.nextFile = undefined

      this.startNextDownload()

      if (next) {
        await this.playFile(next)

        // Now that we're done playing the file, we should delete it.. unless
        // it's the file that's coming up! (This would only happen in the case
        // that all temporary files are stored in the same folder, together;
        // indeed an unusual case, but technically possible.)
        if (next !== this.nextFile) {
          await safeUnlink(next, this.playlist)
        }
      }

      await this.waitForDownload()
    }
  }

  waitForDownload() {
    return new Promise(resolve => {
      if (this.isDownloading) {
        this.once('downloaded', () => resolve())
      } else {
        resolve()
      }
    })
  }

  startNextDownload(moveTimelineIndex = true) {
    this.isDownloading = true

    const picked = (moveTimelineIndex
      ? this.historyController.getNextTrack()
      : this.historyController.currentTrack)
    this.nextTrack = picked

    if (!picked) {
      return null
    }

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

    this.downloadController.download(downloader, picked.downloaderArg)

    this.downloadController.waitForDownload()
      .then(file => {
        this.isDownloading = false
        this.nextFile = file
        this.emit('downloaded')
      })
      .catch(() => {
        console.warn(
          "\x1b[31mFailed to download (or convert) track \x1b[1m" +
          getItemPathString(this.nextTrack) + "\x1b[0m"
        )

        this.startNextDownload()
      })

    return picked
  }

  playFile(file) {
    return this.player.playFile(file)
  }

  async skip() {
    // TODO: It would be nice if this returned the next track, but that
    // probably isn't possible with the current play/loop-setup.

    await this.player.kill()
    this.currentTrack = null
  }

  async skipUpNext() {
    if (this.nextFile) {
      await safeUnlink(this.nextFile, this.playlist)
    }

    // The timeline is always one index ahead.
    const tl = this.historyController.timeline
    tl.splice(this.historyController.timelineIndex - 1, 1)
    this.historyController.fillTimeline()

    this.downloadController.cancel()
    return this.startNextDownload(false)
  }

  async stop() {
    // TODO: How to bork download-controller files?? Wait for it to emit a
    // 'cleaned up' event? This whole program being split-up is a Baaaaad idea.
    this.downloadController.cancel()
    await this.player.kill()
    this.currentTrack = null
    this.stopped = true
  }

  logTrackInfo() {
    const getColorMessage = t => {
      if (!t) return '\x1b[2m(No track)\x1b[0m'

      const path = getItemPathString(t)

      return (
        `\x1b[1m${t.name} \x1b[0m@ ${path} \x1b[2m(${t.downloaderArg})\x1b[0m`
      )
    }

    const getCleanMessage = t => {
      if (!t) return '(No track)'

      const path = getItemPathString(t)

      return `${t.name} @ ${path}`
    }

    const hc = this.historyController
    const tl = hc.timeline
    const tlI = hc.timelineIndex - 1

    for (let i = Math.max(0, tlI - 2); i < tlI; i++) {
      console.log(`\x1b[2m(Prev) ${getCleanMessage(tl[i])}\x1b[0m`)
    }

    console.log(`\x1b[1m(Curr) \x1b[1m${getColorMessage(tl[tlI])}\x1b[0m`)

    for (let i = tlI + 1; i < Math.min(tlI + 3, tl.length); i++) {
      console.log(`(Next) ${getCleanMessage(tl[i])}`)
    }
  }
}

module.exports = async function startLoopPlay(
  playlist, {
    pickerOptions, playerCommand = 'mpv',
    disablePlaybackStatus = false
  }
) {
  // Looping play function. Takes a playlist and an object containing general
  // options (picker options, player command, and disable-playback-status).
  // Stops when the history controller returns null.

  let player
  if (playerCommand === 'sox' || playerCommand === 'play') {
    player = new SoXPlayer()
  } else if (playerCommand === 'mpv') {
    player = new ControllableMPVPlayer()
  } else if (
    playerCommand === 'mpv-nocontrolls' ||
    playerCommand === 'mpv-windows' ||
    playerCommand === 'mpv-nofifo'
  ) {
    player = new MPVPlayer()
  } else {
    if (playerCommand) {
      console.warn('Invalid player command given?', playerCommand)
    } else {
      console.warn('No player command given?')
    }

    return Promise.resolve()
  }

  Object.assign(player, {disablePlaybackStatus})

  const downloadController = new DownloadController(playlist)
  await downloadController.init()

  const historyController = new HistoryController(
    playlist, generalPicker, pickerOptions
  )

  const playController = new PlayController(
    player, playlist, historyController, downloadController
  )

  Object.assign(playController, {playerCommand})

  const promise = playController.loopPlay()

  return {
    promise,
    playController,
    downloadController,
    player
  }
}
