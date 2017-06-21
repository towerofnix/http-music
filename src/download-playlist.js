'use strict'

const fs = require('fs')
const downloaders = require('./downloaders')
const path = require('path')
const processArgv = require('./process-argv')
const sanitize = require('sanitize-filename')

const {
  isGroup, isTrack
} = require('./playlist-utils')

const { promisify } = require('util')

const access = promisify(fs.access)
const mkdir = promisify(fs.mkdir)
const readFile = promisify(fs.readFile)
const readdir = promisify(fs.readdir)
const stat = promisify(fs.stat)
const writeFile = promisify(fs.writeFile)
const ncp = promisify(require('ncp').ncp)

// It's typically bad to attempt to download or copy a million files at once,
// so we create a "promise delayer" that forces only several promises to run at
// at one time.
let delayPromise
{
  const INTERVAL = 50
  const MAX = 5

  let active = 0

  let queue = []

  delayPromise = function(promiseMaker) {
    return new Promise((resolve, reject) => {
      queue.push([promiseMaker, resolve, reject])
    })
  }

  setInterval(async () => {
    if (active >= MAX) {
      return
    }

    const top = queue.pop()

    if (top) {
      const [ promiseMaker, resolve, reject ] = top

      active++

      console.log('Going - queue: ' + queue.length)

      try {
        resolve(await promiseMaker())
      } catch(err) {
        reject(err)
      }

      active--
    }
  }, INTERVAL)
}

async function downloadCrawl(playlist, downloader, outPath = './out/') {
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

  return Promise.all(playlist.map(async (item) => {
    if (isGroup(item)) {
      // TODO: Not sure if this is the best way to pick the next out dir.
      const out = outPath + sanitize(item[0]) + '/'

      return [item[0], await downloadCrawl(item[1], downloader, out)]
    } else if (isTrack(item)) {
      // TODO: How should we deal with songs that don't have an extension?
      const ext = path.extname(item[1])
      const base = path.basename(item[1], ext)
      const out = outPath + base + ext

      // If we've already downloaded a file at some point in previous time,
      // there's no need to download it again!
      //
      // Since we can't guarantee the extension name of the file, we only
      // compare bases.
      //
      // TODO: This probably doesn't work well with things like the YouTube
      // downloader.
      const items = await readdir(outPath)
      const match = items.find(x => path.basename(x, path.extname(x)) === base)
      if (match) {
        console.log(`\x1b[32;2mAlready downloaded: ${out}\x1b[0m`)
        return [item[0], outPath + match]
      }

      console.log(`\x1b[2mDownloading: ${item[0]} - ${item[1]}\x1b[0m`)

      const downloadFile = await delayPromise(() => downloader(item[1]))
      // console.log(downloadFile, path.resolve(out))

      try {
        await delayPromise(() => ncp(downloadFile, path.resolve(out)))
        console.log(`\x1b[32;1mDownloaded: ${out}\x1b[0m`)
        return [item[0], out]
      } catch(err) {
        console.error(`\x1b[31mFailed: ${out}\x1b[0m`)
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
    return
  }

  const playlist = JSON.parse(await readFile(process.argv[2]))

  let downloaderType = 'http'

  processArgv(process.argv.slice(3), {
    '-downloader': util => {
      downloaderType = util.nextArg()
    }
  })

  const dl = downloaders.makePowerfulDownloader(
    downloaders.getDownloader(downloaderType)
  )

  const outPlaylist = await downloadCrawl(playlist, dl)

  await writeFile('out/playlist.json', JSON.stringify(outPlaylist, null, 2))

  console.log('Done - saved playlist to out/playlist.json.')
  process.exit(0)
}

main()
  .catch(err => console.error(err))
