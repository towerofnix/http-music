'use strict'

const fs = require('fs')
const fse = require('fs-extra')
const fetch = require('node-fetch')
const promisifyProcess = require('./promisify-process')
const tempy = require('tempy')
const path = require('path')
const sanitize = require('sanitize-filename')

const { spawn } = require('child_process')
const { promisify } = require('util')

const writeFile = promisify(fs.writeFile)
const copyFile = fse.copy

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
      '--audio-format', 'mp3',
      '--output', tempDir + '/dl.%(ext)s',
      arg
    ]

    return promisifyProcess(spawn('youtube-dl', opts))
      .then(() => tempDir + '/dl.mp3')
      .catch(err => false)
  }
}

function makeLocalDownloader() {
  // Usually we'd just return the given argument in a local
  // downloader, which is efficient, since there's no need to
  // copy a file from one place on the hard drive to another.
  // But reading from a separate drive (e.g. a USB stick or a
  // CD) can take a lot longer than reading directly from the
  // computer's own drive, so this downloader copies the file
  // to a temporary file on the computer's drive.
  // Ideally, we'd be able to check whether a file is on the
  // computer's main drive mount or not before going through
  // the steps to copy, but I'm not sure if there's a way to
  // do that (and it's even less likely there'd be a cross-
  // platform way).

  return function(arg) {
    // It's possible the downloader argument start with the "file://" protocol
    // string; in that case we'll want to snip it off and URL-decode the
    // string.
    const fileProto = 'file://'
    if (arg.startsWith(fileProto)) {
      arg = decodeURIComponent(arg.slice(fileProto.length))
    }

    const dir = tempy.directory()
    // TODO: Is it necessary to sanitize here?
    // Haha, the answer to "should I sanitize" is probably always YES..
    const base = path.basename(arg, path.extname(arg))
    const file = dir + '/' + sanitize(base) + '.mp3'
    return copyFile(arg, file)
      .then(() => file)
  }
}

function makeLocalEchoDownloader() {
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

function makeConverterDownloader(downloader, type) {
  return async function(arg) {
    const inFile = await downloader(arg)
    const base = path.basename(inFile, path.extname(inFile))
    const tempDir = tempy.directory()
    const outFile = `${tempDir}/${base}.${type}`

    await promisifyProcess(spawn('avconv', ['-i', inFile, outFile]), false)

    return outFile
  }
}

module.exports = {
  makeHTTPDownloader,
  makeYouTubeDownloader,
  makeLocalDownloader,
  makePowerfulDownloader,
  makeConverterDownloader,

  byName: {
    'http': makeHTTPDownloader,
    'local': makeLocalDownloader,
    'file': makeLocalDownloader,
    'youtube': makeYouTubeDownloader,
    'youtube-dl': makeYouTubeDownloader
  },

  getDownloaderFor(arg) {
    if (arg.startsWith('http://') || arg.startsWith('https://')) {
      if (arg.includes('youtube.com')) {
        return makeYouTubeDownloader()
      } else {
        return makeHTTPDownloader()
      }
    } else {
      return makeLocalDownloader()
    }
  }
}
