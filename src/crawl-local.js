#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')
const naturalSort = require('node-natural-sort')
const processArgv = require('./process-argv')

const { promisify } = require('util')
const readDir = promisify(fs.readdir)
const stat = promisify(fs.stat)

function crawl(dirPath, extensions = [
  // This list isn't very extensive, and can be customized via the
  // --extensions (or --exts, -e) option.
  'ogg', 'oga',
  'wav', 'mp3', 'mp4', 'm4a', 'aac'
]) {
  return readDir(dirPath).then(items => {
    items.sort(naturalSort())

    return Promise.all(items.map(item => {
      const itemPath = path.join(dirPath, item)

      return stat(itemPath).then(stats => {
        if (stats.isDirectory()) {
          return crawl(itemPath, extensions)
            .then(group => Object.assign({name: item}, group))
        } else if (stats.isFile()) {
          // Extname returns a string starting with a dot; we don't want the
          // dot, so we slice it off of the front.
          const ext = path.extname(item).slice(1)

          if (extensions.includes(ext)) {
            // The name of the track doesn't include the file extension; a user
            // probably wouldn't add the file extensions to a hand-written
            // playlist, or want them in an auto-generated one.
            const basename = path.basename(item, path.extname(item))

            const track = {name: basename, downloaderArg: itemPath}
            return track
          } else {
            return null
          }
        }
      })
    }))
  }).then(items => items.filter(Boolean))
    .then(filteredItems => ({items: filteredItems}))
}

async function main(args) {
  if (args.length === 0) {
    console.log("Usage: crawl-local /example/path [opts]")
    return
  }

  const path = args[0]

  let extensions

  await processArgv(args.slice(1), {
    '-extensions': function(util) {
      // --extensions <extensions>  (alias: --exts, -e)
      // Sets file extensions that are considered music tracks to be added to
      // the result playlist.
      // <extensions> is a comma-separated list of extensions, not including
      // the "dots"; e.g. 'mp3,wav'.
      // A default list of extensions exists but is not *extremely* extensive.
      // (Use --extensions when needed!)

      extensions = util.nextArg().split(',')

      // *Somebody*'s going to start the extensions with dots; may as well be
      // careful for that!
      extensions = extensions.map(e => e.startsWith('.') ? e.slice(1) : e)
    },

    '-exts': util => util.alias('-extensions'),
    'e': util => util.alias('-extensions')
  })

  const res = await crawl(path, extensions)
  console.log(JSON.stringify(res, null, 2))
}

module.exports = {main, crawl}

if (require.main === module) {
  main(process.argv.slice(2))
    .catch(err => console.error(err))
}
