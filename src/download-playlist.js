#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')
const sanitize = require('sanitize-filename')
const promisifyProcess = require('./promisify-process')

const {
  isGroup, isTrack, flattenPlaylist, updatePlaylistFormat
} = require('./playlist-utils')

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
  let total = flattenPlaylist(topPlaylist).length

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
        const out = outPath + sanitize(item[0]) + '/'

        outPlaylist.push([item[0], await recursive(item[1], out)])
      } else if (isTrack(item)) {
        const base = sanitize(path.basename(item[0], path.extname(item[0])))
        const out = outPath + sanitize(base) + '.mp3'

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
          console.log(`\x1b[32;2mAlready downloaded: ${out}\x1b[0m`)
          outPlaylist.push([item[0], outPath + match])
          doneCount++
          status()
          continue
        }

        console.log(`\x1b[2mDownloading: ${item[0]} - ${item[1]}\x1b[0m`)

        console.log(out)

        await promisifyProcess(spawn('mpv', [
          '--no-audio-display',
          item[1], '-o', out,
          '-oac', 'libmp3lame'
        ]))

        outPlaylist.push([item[0], out])
        doneCount++

        status()
      }
    }

    return outPlaylist
  }

  return recursive(topPlaylist.items, initialOutPath)
}

async function main() {
  // TODO: Implement command line stuff here

  if (process.argv.length === 2) {
    console.error('Usage: download-playlist <playlistFile> [opts]')
    return
  }

  const playlist = updatePlaylistFormat(
    JSON.parse(await readFile(process.argv[2]))
  )

  const outPlaylist = await downloadCrawl(playlist)

  await writeFile('out/playlist.json', JSON.stringify(outPlaylist, null, 2))

  console.log('Done - saved playlist to out/playlist.json.')
  process.exit(0)
}

main()
  .catch(err => console.error(err))
