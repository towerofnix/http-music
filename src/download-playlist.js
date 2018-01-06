#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')
const sanitize = require('sanitize-filename')
const promisifyProcess = require('./promisify-process')

const {
  flattenGrouplike, updatePlaylistFormat, getItemPath
} = require('./playlist-utils')

const { getDownloaderFor, makePowerfulDownloader } = require('./downloaders')
const { showTrackProcessStatus } = require('./general-util')
const { promisify } = require('util')
const { spawn } = require('child_process')

const mkdirp = promisify(require('mkdirp'))

const readFile = promisify(fs.readFile)
const readdir = promisify(fs.readdir)

async function downloadCrawl(playlist, topOut = './out/') {
  const flat = flattenGrouplike(playlist)
  let doneCount = 0

  const showStatus = () => {
    showTrackProcessStatus(flat.items.length, doneCount)
  }

  // First off, we go through all tracks and see which are already downloaded.
  // We store the ones that *aren't* downloaded in an 'itemsToDownload' array,
  // which we use later.
  const itemsToDownload = []

  const targetFileSymbol = Symbol('Target file')

  for (let item of flat.items) {
    const parentGroups = getItemPath(item).slice(0, -1)

    const dir = parentGroups.reduce((a, b) => {
      return a + '/' + sanitize(b.name)
    }, topOut) + '/'

    const base = path.basename(item.name, path.extname(item.name))
    const targetFile = dir + sanitize(base) + '.mp3'

    // We'll be using the target file later when we download all tracks, so
    // we save that right on the playlist item.
    item[targetFileSymbol] = targetFile

    await mkdirp(dir)

    // If we've already downloaded a file at some point in previous time,
    // there's no need to download it again!
    //
    // Since we can't guarantee the extension name of the file, we only
    // compare bases.
    //
    // TODO: This probably doesn't work well with things like the YouTube
    // downloader.
    const items = await readdir(dir)
    const match = items.find(item => {
      const itemBase = sanitize(path.basename(item, path.extname(item)))
      return itemBase === base
    })

    if (match) {
      console.log(`\x1b[32;2mAlready downloaded: ${targetFile}\x1b[0m`)
      doneCount++
      showStatus()
    } else {
      itemsToDownload.push(item)
    }
  }

  // Now that we've decided on which items we need to download, we go through
  // and download all of them.
  for (let item of itemsToDownload) {
    const targetFile = item[targetFileSymbol]

    console.log(
      `\x1b[2mDownloading: ${item.name} - ${item.downloaderArg}` +
      ` => ${targetFile}\x1b[0m`
    )

    // Woo-hoo, using block labels for their intended purpose! (Maybe?)
    downloadProcess: {
      const downloader = makePowerfulDownloader(
        getDownloaderFor(item.downloaderArg)
      )

      const outputtedFile = await downloader(item.downloaderArg)

      // If the return of the downloader is false, then the download
      // failed.
      if (outputtedFile === false) {
        console.error(
          `\x1b[33;1mDownload failed (item skipped): ${item.name}\x1b[0m`
        )

        break downloadProcess
      }

      try {
        console.log(targetFile)

        await promisifyProcess(spawn('ffmpeg', [
          '-i', outputtedFile,

          // A bug (in ffmpeg or macOS; not this) makes it necessary to have
          // these options on macOS, otherwise the outputted file length is
          // wrong.
          '-write_xing', '0',

          targetFile
        ]), false)
      } catch(err) {
        console.error(
          `\x1b[33;1mFFmpeg failed (item skipped): ${item.name}\x1b[0m`
        )

        break downloadProcess
      }
    }

    doneCount++

    showStatus()
  }
}

async function main(args) {
  // TODO: Implement command line stuff here

  if (args.length === 0) {
    console.error('Usage: download-playlist <playlistFile> [opts]')
    return
  }

  const playlist = updatePlaylistFormat(JSON.parse(await readFile(args[0])))

  await downloadCrawl(playlist)

  console.log(
    'Done - downloaded to out/. (Use crawl-local out/ to create a playlist.)'
  )
}

module.exports = main

if (require.main === module) {
  main(process.argv.slice(2))
    .catch(err => console.error(err))
}
