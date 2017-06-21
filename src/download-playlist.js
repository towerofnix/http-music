'use strict'

const fs = require('fs')
const downloaders = require('./downloaders')
const path = require('path')
const sanitize = require('sanitize-filename')

const {
  isGroup, isTrack
} = require('./playlist-utils')

const { promisify } = require('util')

const access = promisify(fs.access)
const mkdir = promisify(fs.mkdir)
const readFile = promisify(fs.readFile)
const readdir = promisify(fs.readdir)
const rename = promisify(fs.rename)
const stat = promisify(fs.stat)
const writeFile = promisify(fs.writeFile)

async function downloadCrawl(playlist, downloader, outPath = './out/') {
  let doesExist = true
  try {
    doesExist = (await stat(outPath)).isDirectory()
  } catch(err) {
    doesExist = false
  }

  if (!doesExist) {
    await mkdir(outPath)
  }

  return Promise.all(playlist.map(async (item) => {
    if (isGroup(item)) {
      // TODO: Not sure if this is the best way to pick the next out dir.
      const out = outPath + sanitize(item[0]) + '/'

      return [item[0], await downloadCrawl(item[1], downloader, out)]
    } else if (isTrack(item)) {
      console.log(`\x1b[2m${item[0]} - ${item[1]}\x1b[0m`)

      // TODO: How to deal with songs that don't have an extension?
      const ext = path.extname(item[1])
      const base = path.basename(item[1], ext)

      const items = await readdir(outPath)
      const match = items.find(x => path.basename(x, path.extname(x)) === base)
      if (match) {
        return [item[0], outPath + match]
      }

      const downloadFile = await downloader(item[1])
      // const base = path.basename(downloadFile)
      // const out = outPath + base

      // console.log(`\x1b[1m${downloadFile}\x1b[0m`)

      try {
        await rename(downloadFile, path.resolve(out))
        console.log(`\x1b[1m${out}\x1b[0m`)
        return [item[0], out]
      } catch(err) {
        console.error(`\x1b[31mFAILED: ${out}\x1b[0m`)
        console.error(err)
        return false
      }
    }
  })).then(p => p.filter(Boolean))
}

async function main() {
  // TODO: Implement command line stuff here

  if (process.argv.length === 2) {
    console.error('Usage: download-playlist <playlistFile> [opts]')
    process.exit(1)
    return
  }

  const playlist = JSON.parse(await readFile(process.argv[2]))

  const dl = downloaders.makePowerfulDownloader(
    downloaders.makeHTTPDownloader()
  )

  const outPlaylist = await downloadCrawl(playlist, dl)

  writeFile('out/playlist.json', JSON.stringify(outPlaylist, null, 2))

  console.log('Done - saved playlist to out/playlist.json.')
}

main()
  .catch(err => console.error(err))
