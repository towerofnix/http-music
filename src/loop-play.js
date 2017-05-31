'use strict'

const fs = require('fs')

const { spawn } = require('child_process')
const { promisify } = require('util')
const fetch = require('node-fetch')
const sanitize = require('sanitize-filename')
const promisifyProcess = require('./promisify-process')

const writeFile = promisify(fs.writeFile)
const unlink = promisify(fs.unlink)

module.exports = async function loopPlay(fn) {
  // Looping play function. Takes one argument, the "pick" function,
  // which returns a track to play. Preemptively downloads the next
  // track while the current one is playing for seamless continuation
  // from one song to the next. Stops when the result of the pick
  // function is null (or similar).

  async function downloadNext() {
    const picked = fn()

    if (picked == null) {
      return false
    }

    const [ title, href ] = picked
    console.log(`Downloading ${title}..\n${href}`)

    const wavFile = `.${sanitize(title)}.wav`

    const res = await fetch(href)
    const buffer = await res.buffer()
    await writeFile('./.temp-track', buffer)

    try {
      await convert('./.temp-track', wavFile)
    } catch(err) {
      console.warn("Failed to convert " + title)
      console.warn("Selecting a new track\n")

      return await downloadNext()
    }

    await unlink('./.temp-track')

    return wavFile
  }

  let wavFile = await downloadNext()

  while (wavFile) {
    const nextPromise = downloadNext()
    await playFile(wavFile)
    await unlink(wavFile)
    wavFile = await nextPromise
  }
}

function convert(fromFile, toFile) {
  const avconv = spawn('avconv', ['-y', '-i', fromFile, toFile])
  return promisifyProcess(avconv, false)
}

function playFile(file) {
  const play = spawn('play', [file])
  return promisifyProcess(play)
}
