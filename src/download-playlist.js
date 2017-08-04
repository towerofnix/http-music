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
const { promisify } = require('util')
const { spawn } = require('child_process')

const mkdirp = promisify(require('mkdirp'))

const readFile = promisify(fs.readFile)
const readdir = promisify(fs.readdir)

async function downloadCrawl(playlist, topOut = './out/') {
  const flat = flattenGrouplike(playlist)
  let doneCount = 0

  const status = function() {
    const total = flat.items.length
    const percent = Math.trunc(doneCount / total * 10000) / 100
    console.log(
      `\x1b[1mDownload crawler - ${percent}% completed ` +
      `(${doneCount}/${total} tracks)\x1b[0m`)
  }

  for (let item of flat.items) {
    const parentGroups = getItemPath(item).slice(0, -1)

    const dir = parentGroups.reduce((a, b) => {
      return a + '/' + sanitize(b.name)
    }, topOut) + '/'

    await mkdirp(dir)

    const base = path.basename(item.name, path.extname(item.name))
    const targetFile = dir + sanitize(base) + '.mp3'

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
      status()
      continue
    }

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

      console.log('Added:', item.name)
    }

    doneCount++

    status()
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
