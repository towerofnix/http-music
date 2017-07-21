#!/usr/bin/env node

// Let this forever be of use to people who run into
// maxlistenersexceededwarning.
process.on('warning', e => console.warn(e.stack))

async function main(args) {
  let script

  if (args.length === 0) {
    console.error("No command provided.")
    console.error("Try 'man http-music'?")
    return
  }

  switch (args[0]) {
    case 'play': script = require('./play'); break
    case 'crawl-http': script = require('./crawl-http'); break
    case 'crawl-local': script = require('./crawl-local'); break
    case 'crawl-itunes': script = require('./crawl-itunes'); break
    case 'crawl-youtube': script = require('./crawl-youtube'); break
    case 'download-playlist': script = require('./download-playlist'); break

    default:
      console.error(`Invalid command "${args[0]}" provided.`)
      console.error("Try 'man http-music'?")
      return
  }

  await script(args.slice(1))
}

module.exports = main

if (require.main === module) {
  main(process.argv.slice(2))
    .catch(err => console.error(err))
}
