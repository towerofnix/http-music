#!/usr/bin/env node

// Let this forever be of use to people who run into
// maxlistenersexceededwarning.
process.on('warning', e => console.warn(e.stack))

const { getCrawlerByName } = require('./crawlers')

async function main(args) {
  let script

  if (args.length === 0) {
    console.error("No command provided.")
    console.error("Try 'man http-music'?")
    return
  }

  const module = getCrawlerByName(args[0])

  if (module) {
    script = module.main
  } else {
    switch (args[0]) {
      case 'play': script = require('./play'); break
      case 'download-playlist': script = require('./download-playlist'); break
      case 'process-metadata': script = require('./process-metadata'); break
      case 'smart-playlist': script = require('./smart-playlist'); break
      case 'duration-graph': script = require('./duration-graph'); break
      case 'setup': script = require('./setup'); break

      default:
        console.error(`Invalid command "${args[0]}" provided.`)
        console.error("Try 'man http-music'?")
        return
    }
  }

  await script(args.slice(1))
}

module.exports = main

if (require.main === module) {
  main(process.argv.slice(2))
    .catch(err => console.error(err))
}
