#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')
const sanitize = require('sanitize-filename')
const promisifyProcess = require('./promisify-process')

const {
  isGroup, isTrack, flattenGrouplike, updatePlaylistFormat
} = require('./playlist-utils')

const { getDownloaderFor, makePowerfulDownloader } = require('./downloaders')
const { promisify } = require('util')
const { spawn } = require('child_process')

const access = promisify(fs.access)
const mkdir = promisify(fs.mkdir)
const readFile = promisify(fs.readFile)
const readdir = promisify(fs.readdir)
const stat = promisify(fs.stat)
const writeFile = promisify(fs.writeFile)

async function downloadCrawl(topPlaylist, initialOutPath = './out/') {
  let doneCount = 0
  let total = flattenGrouplike(topPlaylist).items.length

  const status = function() {
    const percent = Math.trunc(doneCount / total * 10000) / 100
    console.log(
      `\x1b[1mDownload crawler - ${percent}% completed ` +
      `(${doneCount}/${total} tracks)\x1b[0m`)
  }

  const recursive = async function(groupContents, outPath) {
    // If the output folder doesn't exist, we should create it.
    let doesExist = true
    try {
      doesExist = (await stat(outPath)).isDirectory()
    } catch(err) {
      doesExist = false
    }

    if (!doesExist) {
      await mkdir(outPath)
    }

    let outPlaylist = []

    for (let item of groupContents) {
      if (isGroup(item)) {
        // TODO: Not sure if this is the best way to pick the next out dir.
        const out = outPath + sanitize(item.name) + '/'

        outPlaylist.push({
          name: item.name,
          items: await recursive(item.items, out)
        })
      } else if (isTrack(item)) {
        const base = path.basename(item.name, path.extname(item.name))
        const targetFile = outPath + sanitize(base) + '.mp3'

        // If we've already downloaded a file at some point in previous time,
        // there's no need to download it again!
        //
        // Since we can't guarantee the extension name of the file, we only
        // compare bases.
        //
        // TODO: This probably doesn't work well with things like the YouTube
        // downloader.
        const items = await readdir(outPath)
        const match = items.find(item => {
          const itemBase = sanitize(path.basename(item, path.extname(item)))
          return itemBase === base
        })

        if (match) {
          console.log(`\x1b[32;2mAlready downloaded: ${targetFile}\x1b[0m`)
          outPlaylist.push({name: item.name, downloaderArg: outPath + match})
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
          outPlaylist.push({name: item.name, downloaderArg: targetFile})
        }

        doneCount++

        status()
      }
    }

    return outPlaylist
  }

  return {items: await recursive(topPlaylist.items, initialOutPath)}
}

async function main(args) {
  // TODO: Implement command line stuff here

  if (args.length === 0) {
    console.error('Usage: download-playlist <playlistFile> [opts]')
    return
  }

  const playlist = updatePlaylistFormat(JSON.parse(await readFile(args[0])))

  const outPlaylist = await downloadCrawl(playlist)

  await writeFile('out/playlist.json', JSON.stringify(outPlaylist, null, 2))

  console.log('Done - saved playlist to out/playlist.json.')
  process.exit(0)
}

module.exports = main

if (require.main === module) {
  main(process.argv.slice(2))
    .catch(err => console.error(err))
}
