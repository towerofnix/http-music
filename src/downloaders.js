'use strict'

const fs = require('fs')
const fetch = require('node-fetch')
const promisifyProcess = require('./promisify-process')
const tempy = require('tempy')
const path = require('path')
const sanitize = require('sanitize-filename')

const { spawn } = require('child_process')
const { promisify } = require('util')

const writeFile = promisify(fs.writeFile)

function makeHTTPDownloader() {
  return function(arg) {
    const dir = tempy.directory()
    const out = dir + '/' + sanitize(decodeURIComponent(path.basename(arg)))

    return fetch(arg)
      .then(response => response.buffer())
      .then(buffer => writeFile(out, buffer))
      .then(() => out)
  }
}

function makeYouTubeDownloader() {
  return function(arg) {
    const tempDir = tempy.directory()

    const opts = [
      '--quiet',
      '--extract-audio',
      '--audio-format', 'wav',
      '--output', tempDir + '/dl.%(ext)s',
      arg
    ]

    return promisifyProcess(spawn('youtube-dl', opts))
      .then(() => tempDir + '/dl.wav')
  }
}

function makeLocalDownloader() {
  return function(arg) {
    // Since we're grabbing the file from the local file system, there's no
    // need to download or copy it!
    return arg
  }
}

function makePowerfulDownloader(downloader, maxAttempts = 5) {
  // This should totally be named better..

  return async function recursive(arg, attempts = 0) {
    try {
      return await downloader(arg)
    } catch(err) {
      if (attempts < maxAttempts) {
        console.warn('Failed - attempting again:', arg)
        return await recursive(arg, attempts + 1)
      } else {
        throw err
      }
    }
  }
}

module.exports = {
  makeHTTPDownloader,
  makeYouTubeDownloader,
  makeLocalDownloader,
  makePowerfulDownloader,

  getDownloader: downloaderType => {
    if (downloaderType === 'http') {
      return makeHTTPDownloader()
    } else if (downloaderType === 'youtube') {
      return makeYouTubeDownloader()
    } else if (downloaderType === 'local') {
      return makeLocalDownloader()
    } else {
      return null
    }
  }
}
