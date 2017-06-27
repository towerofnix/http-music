'use strict'

const { spawn } = require('child_process')
const promisifyProcess = require('./promisify-process')
const sanitize = require('sanitize-filename')
const tempy = require('tempy')
const path = require('path')

const FIFO = require('fifo-js')

const EventEmitter = require('events')

class PlayController {
  constructor(picker) {
    this.currentTrack = null
    this.playArgs = []
    this.process = null
    this.picker = picker
  }

  async loopPlay() {
    // Playing music in a loop isn't particularly complicated; essentially, we
    // just want to keep picking and playing tracks until none is picked.

    let nextTrack = await this.picker()

    while (nextTrack) {
      this.currentTrack = nextTrack

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

module.exports = function loopPlay(picker, playArgs = []) {
  // Looping play function. Takes one argument, the "pick" function,
  // which returns a track to play. Preemptively downloads the next
  // track while the current one is playing for seamless continuation
  // from one song to the next. Stops when the result of the pick
  // function is null (or similar). Optionally takes a second argument
  // used as arguments to the `play` process (before the file name).

  const playController = new PlayController(picker)
  playController.playArgs = playArgs

  const promise = playController.loopPlay()

  return {
    promise,

    seekBack: secs => playController.seekBack(secs),
    seekAhead: secs => playController.seekAhead(secs),
    skipCurrent: () => playController.skipCurrent(),
    volUp: amount => playController.volUp(amount),
    volDown: amount => playController.volDown(amount),
    togglePause: () => playController.togglePause(),

    kill: function() {
      playController.killProcess()
    },

    logTrackInfo: function() {
      if (playController.currentTrack) {
        const [ curTitle, curArg ] = playController.currentTrack
        console.log(`Playing: \x1b[1m${curTitle} \x1b[2m${curArg}\x1b[0m`)
      } else {
        console.log("No song currently playing.")
      }
    }
  }
}
