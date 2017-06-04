const fs = require('fs')
const fetch = require('node-fetch')
const promisifyProcess = require('./promisify-process')
const tempy = require('tempy')

const { spawn } = require('child_process')
const { promisify } = require('util')

const writeFile = promisify(fs.writeFile)

function makeHTTPDownloader() {
  return function(arg) {
    const out = tempy.file()

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
      '--extract-audio',
      '--audio-format', 'wav',
      '--output', tempDir + '/dl.%(ext)s',
      arg
    ]

    return promisifyProcess(spawn('youtube-dl', opts), false)
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

module.exports = {
  makeHTTPDownloader,
  makeYouTubeDownloader,
  makeLocalDownloader
}
