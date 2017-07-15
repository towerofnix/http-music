#!/usr/bin/env node

'use strict'

const fs = require('fs')
const path = require('path')
const xmldoc = require('xmldoc')

const { promisify } = require('util')
const readFile = promisify(fs.readFile)

function getDictValue(dict, key) {
  if (dict.name !== 'dict') {
    throw new Error("Not a dict: " + dict.name)
  }

  for (let i = 0; i < dict.children.length; i++) {
    const child = dict.children[i]
    if (child.name === 'key') {
      if (child.val === key) {
        return dict.children.slice(i + 1).find(item => !item.text)
      }
    }
  }

  return null
}

async function crawl(libraryXML) {
  const document = new xmldoc.XmlDocument(libraryXML)

  const libraryDict = document.children.find(child => child.name === 'dict')

  const tracksDict = getDictValue(libraryDict, 'Tracks')

  const trackDicts = tracksDict.children.filter(child => child.name === 'dict')

  const result = []

  for (let trackDict of trackDicts) {
    let kind = getDictValue(trackDict, 'Kind')
    kind = kind && kind.val
    kind = kind || ''

    if (!kind.includes('audio file')) {
      continue
    }

    let location = getDictValue(trackDict, 'Location')
    location = location && location.val
    location = location || ''

    if (!location) {
      continue
    }

    let name = getDictValue(trackDict, 'Name')
    name = name && name.val
    name = name || 'Unknown Name'

    let album = getDictValue(trackDict, 'Album')
    album = album && album.val
    album = album || 'Unknown Album'

    let artist = getDictValue(trackDict, 'Artist')
    artist = artist && artist.val
    artist = artist || 'Unknown Artist'

    // console.log(`${artist} - ${name} (${album})`)

    const group = (arr, title) => arr.find(g => g[0] === title)

    let artistGroup = group(result, artist)

    if (!artistGroup) {
      artistGroup = [artist, []]
      result.push(artistGroup)
    }

    let albumGroup = group(artistGroup[1], album)

    if (!albumGroup) {
      albumGroup = [album, []]
      artistGroup[1].push(albumGroup)
    }

    albumGroup[1].push([name, location])
  }

  return result
}

async function main() {
  const libraryPath = process.argv[2] || (
    `${process.env.HOME}/Music/iTunes/iTunes Music Library.xml`
  )

  const library = await readFile(libraryPath)

  const playlist = await crawl(library)

  console.log(JSON.stringify(playlist, null, 2))
}

main()
  .catch(err => console.error(err))
