'use strict'

const fs = require('fs')
const { getCrawlerByName } = require('./crawlers')

const { promisify } = require('util')
const readFile = promisify(fs.readFile)

async function processItem(item) {
  // Object.assign is used so that we keep original properties, e.g. "name"
  // or "apply". (It's also used so we return copies of original objects.)

  if ('source' in item) {
    const [ name, ...args ] = item.source

    const crawlModule = getCrawlerByName(name)

    if (crawlModule === null) {
      console.error(`No crawler by name ${name} - skipped item:`, item)
      return Object.assign({}, item, {failed: true})
    }

    const { crawl } = crawlModule

    return Object.assign({}, item, await crawl(...args))
  } else if ('items' in item) {
    return Object.assign({}, item, {
      items: await Promise.all(item.items.map(processItem))
    })
  } else {
    return Object.assign({}, item)
  }
}

module.exports = processItem

async function main(opts) {
  // TODO: Error when no file is given

  if (opts.length === 0) {
    console.log("Usage: smart-playlist /path/to/playlist")
  } else {
    const playlist = JSON.parse(await readFile(opts[0]))
    console.log(JSON.stringify(await processItem(playlist), null, 2))
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .catch(err => console.error(err))
}
