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

function findChild(grouplike, name) {
  return grouplike.items.find(x => x.name === name)
}

async function crawl(libraryXML) {
  const document = new xmldoc.XmlDocument(libraryXML)

  const libraryDict = document.children.find(child => child.name === 'dict')

  const tracksDict = getDictValue(libraryDict, 'Tracks')

  const trackDicts = tracksDict.children.filter(child => child.name === 'dict')

  const resultGroup = {items: []}

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

    let artist = getDictValue(trackDict, 'Album Artist')
    artist = artist || getDictValue(trackDict, 'Artist')
    artist = artist && artist.val
    artist = artist || 'Unknown Artist'

    // console.log(`${artist} - ${name} (${album})`)

    let artistGroup = findChild(resultGroup, artist)

    if (!artistGroup) {
      artistGroup = {name: artist, items: []}
      resultGroup.items.push(artistGroup)
    }

    let albumGroup = findChild(artistGroup, album)

    if (!albumGroup) {
      albumGroup = {name: album, items: []}
      artistGroup.items.push(albumGroup)
    }

    albumGroup.items.push({name, downloaderArg: location})
  }

  return resultGroup
}

async function main() {
  const libraryPath = process.argv[2] || (
    `${process.env.HOME}/Music/iTunes/iTunes Music Library.xml`
  )

  let library

  try {
    library = await readFile(libraryPath)
  } catch(err) {
    if (err.code === 'ENOENT') {
      console.error(
        "It looks like you aren't sharing the iTunes Library XML file."
      )
      console.error(
        "To do that, just open up iTunes, select iTunes > Preferences from " +
        "the menu bar, select the Advanced section, enable the " +
        "\"Share iTunes Library XML with other applications\" checkbox, and " +
        "click on OK."
      )
      console.error("Then run the crawl-itunes command again.")
      console.error(
        "(Or, if you're certain it *is* being shared, you could try " +
        "entering the path to the file as an argument to crawl-itunes.)"
      )
      process.exit(1)
      return
    } else {
      throw err
    }
  }

  const playlist = await crawl(library)

  console.log(JSON.stringify(playlist, null, 2))
}

main()
  .catch(err => console.error(err))
