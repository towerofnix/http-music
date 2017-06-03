const fs = require('fs')
const fetch = require('node-fetch')
const promisifyProcess = require('./promisify-process')
const tempy = require('tempy')

const { spawn } = require('child_process')
const { promisify } = require('util')

const writeFile = promisify(fs.writeFile)
const rename = promisify(fs.rename)

function makeHTTPDownloader() {
  return function(arg, out) {
    return fetch(arg)
      .then(response => response.buffer())
      .then(buffer => writeFile(out, buffer))
  }
}

function makeYouTubeDownloader() {
  return function(arg, out) {
    const tempDir = tempy.directory()

    const opts = [
      '--extract-audio',
      '--audio-format', 'wav',
      '--output', tempDir + '/dl.%(ext)s',
      arg
    ]

    return promisifyProcess(spawn('youtube-dl', opts), false)
      .then(() => rename(tempDir + '/dl.wav', out))
  }
}

module.exports = {makeHTTPDownloader, makeYouTubeDownloader}