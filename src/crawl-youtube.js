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

async function main(args) {
  // TODO: Error message if none is passed.

  if (args.length === 0) {
    console.error("Usage: crawl-youtube <playlist URL>")
  } else {
    console.log(JSON.stringify(await crawl(args[0]), null, 2))
  }
}

module.exports = {main, crawl}

if (require.main === module) {
  main(process.argv.slice(2))
    .catch(err => console.error(err))
}
