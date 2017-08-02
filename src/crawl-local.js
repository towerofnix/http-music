#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')
const naturalSort = require('node-natural-sort')

const { promisify } = require('util')
const readDir = promisify(fs.readdir)
const stat = promisify(fs.stat)

function crawl(dirPath) {
  return readDir(dirPath).then(items => {
    items.sort(naturalSort())

    return Promise.all(items.map(item => {
      const itemPath = path.join(dirPath, item)

      return stat(itemPath).then(stats => {
        if (stats.isDirectory()) {
          return crawl(itemPath)
            .then(group => Object.assign(group, {name: item}))
        } else if (stats.isFile()) {
          const track = {name: item, downloaderArg: itemPath}
          return track
        }
      })
    }))
  }).then(items => ({items}))
}

async function main(args) {
  if (args.length === 0) {
    console.log("Usage: crawl-local /example/path")
  } else {
    const path = args[0]

    const res = await crawl(path)
    console.log(JSON.stringify(res, null, 2))
  }
}

module.exports = {main, crawl}

if (require.main === module) {
  main(process.argv.slice(2))
    .catch(err => console.error(err))
}
