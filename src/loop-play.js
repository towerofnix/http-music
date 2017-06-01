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

module.exports = async function loopPlay(picker, downloader, playArgs = []) {
  // Looping play function. Takes one argument, the "pick" function,
  // which returns a track to play. Preemptively downloads the next
  // track while the current one is playing for seamless continuation
  // from one song to the next. Stops when the result of the pick
  // function is null (or similar). Optionally takes a second argument
  // used as arguments to the `play` process (before the file name).

  async function downloadNext() {
    const picked = picker()

    if (picked == null) {
      return false
    }

    const [ title, downloaderArg ] = picked
    console.log(`Downloading ${title}..\nDownloader arg: ${downloaderArg}`)

    const tempDir = tempy.directory()
    const wavFile = tempDir + `/.${sanitize(title)}.wav`
    const downloadFile = tempDir + '/.dl-' + path.basename(downloaderArg)

    await downloader(downloaderArg, downloadFile)

    try {
      await convert(downloadFile, wavFile)
    } catch(err) {
      console.warn("Failed to convert " + title)
      console.warn("Selecting a new track\n")

      return await downloadNext()
    }

    return wavFile
  }

  let wavFile = await downloadNext()

  while (wavFile) {
    const nextPromise = downloadNext()
    await playFile(wavFile, playArgs)
    wavFile = await nextPromise
  }
}

function convert(fromFile, toFile) {
  const avconv = spawn('avconv', ['-y', '-i', fromFile, toFile])
  return promisifyProcess(avconv, false)
}

function playFile(file, opts = []) {
  const play = spawn('play', [...opts, file])
  return promisifyProcess(play)
}
