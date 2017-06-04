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
          return crawl(itemPath).then(contents => {
            const group = [item, contents]
            return group
          })
        } else if (stats.isFile()) {
          const track = [item, itemPath]
          return track
        }
      })
    }))
  })
}

if (process.argv.length === 2) {
  console.log("Usage: http-music-crawl-local /example/path..")
  console.log("..or, npm run crawl-local /example/path")
} else {
  const path = process.argv[2]

  crawl(path)
    .then(res => console.log(JSON.stringify(res, null, 2)))
    .catch(err => console.error(err))
}
