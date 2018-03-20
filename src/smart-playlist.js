'use strict'

const fs = require('fs')
const { getCrawlerByName } = require('./crawlers')
const { isGroup, filterTracks, sourceSymbol, updatePlaylistFormat } = require('./playlist-utils')

const { promisify } = require('util')
const readFile = promisify(fs.readFile)

async function processSmartPlaylist(item, topItem = true) {
  // Object.assign is used so that we keep original properties, e.g. "name"
  // or "apply". (It's also used so we return copies of original objects.)

  if (topItem) {
    item = await updatePlaylistFormat(item)
  }

  const newItem = Object.assign({}, item)

  if ('source' in newItem) {
    const [ name, ...args ] = item.source

    const crawlModule = getCrawlerByName(name)

    if (crawlModule) {
      const { crawl } = crawlModule
      Object.assign(newItem, await crawl(...args))
    } else {
      console.error(`No crawler by name ${name} - skipped item:`, item)
      newItem.failed = true
    }

    delete newItem.source
  } else if ('items' in newItem) {
    // Pass topItem = false, since we don't want to use updatePlaylistFormat
    // on these items.
    newItem.items = await Promise.all(item.items.map(x => processSmartPlaylist(x, false)))
  }

  if ('filters' in newItem) filters: {
    if (!isGroup(newItem)) {
      console.warn('Filter on non-group (no effect):', newItem)
      break filters
    }

    newItem.filters = newItem.filters.filter(filter => {
      if ('tag' in filter === false) {
        console.warn('Filter is missing "tag" property (skipping this filter):', filter)
        return false
      }

      return true
    })

    Object.assign(newItem, filterTracks(newItem, track => {
      for (const filter of newItem.filters) {
        const { tag } = filter

        let value = track
        for (const key of tag.split('.')) {
          if (key in Object(value)) {
            value = value[key]
          } else {
            console.warn(`In tag "${tag}", key "${key}" not found.`)
            console.warn('...value until now:', value)
            console.warn('...track:', track)
            console.warn('...filter:', filter)
            return false
          }
        }

        if ('gt' in filter && value <= filter.gt) return false
        if ('lt' in filter && value >= filter.lt) return false
        if ('gte' in filter && value < filter.gte) return false
        if ('lte' in filter && value > filter.lte) return false
        if ('least' in filter && value < filter.least) return false
        if ('most' in filter && value > filter.most) return false
        if ('min' in filter && value < filter.min) return false
        if ('max' in filter && value > filter.max) return false

        for (const prop of ['includes', 'contains']) {
          if (prop in filter) {
            if (Array.isArray(value) || typeof value === 'string') {
              if (!value.includes(filter.includes)) return false
            } else {
              console.warn(
                `Value of tag "${tag}" is not an array or string, so passing ` +
                `"${prop}" does not make sense.`
              )
              console.warn('...value:', value)
              console.warn('...track:', track)
              console.warn('...filter:', filter)
              return false
            }
          }
        }

        if (filter.regex) {
          if (typeof value === 'string') {
            let re
            try {
              re = new RegExp(filter.regex)
            } catch (error) {
              console.warn('Invalid regular expression:', re)
              console.warn('...error message:', error.message)
              console.warn('...filter:', filter)
              return false
            }
            if (!re.test(value)) return false
          } else {
            console.warn(
              `Value of tag "${tag}" is not a string, so passing "regex" ` +
              'does not make sense.'
            )
            console.warn('...value:', value)
            console.warn('...track:', track)
            console.warn('...filter:', filter)
            return false
          }
        }
      }

      return true
    }))

    delete newItem.filters
  }

  if (topItem) {
    // We pass true so that the playlist-format-updater knows that this
    // is going to be the source playlist, probably.
    return updatePlaylistFormat(newItem, true)
  } else {
    return newItem
  }
}

async function main(opts) {
  // TODO: Error when no file is given

  if (opts.length === 0) {
    console.log("Usage: smart-playlist /path/to/playlist")
  } else {
    const playlist = JSON.parse(await readFile(opts[0]))
    console.log(JSON.stringify(await processSmartPlaylist(playlist), null, 2))
  }
}

module.exports = Object.assign(main, {processSmartPlaylist})

if (require.main === module) {
  main(process.argv.slice(2))
    .catch(err => console.error(err))
}
