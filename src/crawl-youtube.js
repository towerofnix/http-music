'use strict'

const { spawn } = require('child_process')
const promisifyProcess = require('./promisify-process')

async function crawl(url) {
  const ytdl = spawn('youtube-dl', [
    '-j', // Output as JSON
    '--flat-playlist',
    url
  ])

  const items = []

  ytdl.stdout.on('data', data => {
    const lines = data.toString().trim().split('\n')

    items.push(...lines.map(JSON.parse))
  })

  // Don't show logging.
  await promisifyProcess(ytdl, false)

  return {
    items: items.map(item => {
      return {
        name: item.title,
        downloaderArg: 'https://youtube.com/watch?v=' + item.id
      }
    })
  }
}

async function main(args, shouldReturn = false) {
  // TODO: Error message if none is passed.

  if (args.length === 0) {
    console.error("Usage: crawl-youtube <playlist URL>")
    return
  }

  const playlist = await crawl(args[0])
  const str = JSON.stringify(playlist, null, 2)
  if (shouldReturn) {
    return str
  } else {
    console.log(str)
  }
}

module.exports = {main, crawl}

if (require.main === module) {
  main(process.argv.slice(2))
    .catch(err => console.error(err))
}
