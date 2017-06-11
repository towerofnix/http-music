'use strict'

const fs = require('fs')
const tempy = require('tempy')

const { spawn } = require('child_process')
const { promisify } = require('util')
const fetch = require('node-fetch')
const path = require('path')
const promisifyProcess = require('./promisify-process')
const sanitize = require('sanitize-filename')

const writeFile = promisify(fs.writeFile)

module.exports = function loopPlay(picker, downloader, playArgs = []) {
  // Looping play function. Takes one argument, the "pick" function,
  // which returns a track to play. Preemptively downloads the next
  // track while the current one is playing for seamless continuation
  // from one song to the next. Stops when the result of the pick
  // function is null (or similar). Optionally takes a second argument
  // used as arguments to the `play` process (before the file name).

  let playProcess, convertProcess

  async function downloadNext() {
    const picked = picker()

    if (picked == null) {
      return false
    }

    const [ title, downloaderArg ] = picked
    console.log(`Downloading ${title}..\nDownloader arg: ${downloaderArg}`)

    const downloadFile = await downloader(downloaderArg)

    const tempDir = tempy.directory()
    const wavFile = tempDir + `/.${sanitize(title)}.wav`

    try {
      const convertPromise = convert(downloadFile, wavFile)
      convertProcess = convertPromise.process
      await convertPromise
    } catch(err) {
      console.warn("Failed to convert " + title)
      console.warn("Selecting a new track\n")

      return await downloadNext()
    }

    return wavFile
  }

  async function main() {
    let wavFile = await downloadNext()

    while (wavFile) {
      const nextPromise = downloadNext()

      // What a mouthful!
      const playPromise = playFile(wavFile, playArgs)
      playProcess = playPromise.process

      try {
        await playPromise
      } catch(err) {
        console.warn(err)
      }

      wavFile = await nextPromise
    }
  }

  const promise = main()

  return {
    promise,

    skip: function() {
      if (playProcess) playProcess.kill()
    },

    kill: function() {
      if (playProcess) playProcess.kill()
      if (convertProcess) convertProcess.kill()
    }
  }
}

function convert(fromFile, toFile) {
  const avconv = spawn('avconv', ['-y', '-i', fromFile, toFile])
  return promisifyProcess(avconv, false)
}

function playFile(file, opts = []) {
  const play = spawn('play', [...opts, file])
  return Object.assign(promisifyProcess(play), {process: play})
}
