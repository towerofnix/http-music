#!/usr/bin/env node

'use strict'

const fetch = require('node-fetch')
const cheerio = require('cheerio')
const url = require('url')
const path = require('path')
const processArgv = require('./process-argv')

function crawl(absURL, opts = {}, internals = {}) {
  // Recursively crawls a given URL, following every link to a deeper path and
  // recording all links in a tree (in the same format playlists use). Makes
  // multiple attempts to download failed paths.

  const {
    verbose = false,

    maxAttempts = 5,

    keepSeparateHosts = false,

    keepAnyFileType = false,
    fileTypes = ['wav', 'ogg', 'oga', 'mp3', 'mp4', 'm4a', 'mov'],

    filterRegex = null
  } = opts

  if (!internals.attempts) internals.attempts = 0

  // TODO: Should absURL initially be added into this array? I'd like to
  // re-program this entire crawl function to make more sense - "internal"
  // dictionaries aren't quite easy to reason about!
  if (!internals.allURLs) internals.allURLs = []

  const verboseLog = text => {
    if (verbose) {
      console.log(text)
    }
  }

  const absURLObj = new url.URL(absURL)

  return fetch(absURL)
    .then(
      res => res.text().then(text => {
        const links = getHTMLLinks(text)

        return Promise.all(links.map(link => {
          const [ name, href ] = link
          const urlObj = new url.URL(href, absURL)
          const linkURL = url.format(urlObj)

          if (internals.allURLs.includes(linkURL)) {
            verboseLog("[Ignored] Already done this URL: " + linkURL)

            return false
          }

          internals.allURLs.push(linkURL)

          if (filterRegex && !(filterRegex.test(linkURL))) {
            verboseLog("[Ignored] Failed regex: " + linkURL)

            return false
          }

          if (!keepSeparateHosts && urlObj.host !== absURLObj.host) {
            verboseLog("[Ignored] Inconsistent host: " + linkURL)

            return false
          }

          if (href.endsWith('/')) {
            // It's a directory!

            verboseLog("[Dir] " + linkURL)

            return crawl(linkURL, opts, Object.assign({}, internals))
              .then(items => ({name, items}))
          } else {
            // It's a file!

            const extensions = fileTypes.map(t => '.' + t)

            if (
              !keepAnyFileType &&
              !(extensions.includes(path.extname(href)))
            ) {
              verboseLog("[Ignored] Bad extension: " + linkURL)

              return false
            }

            verboseLog("[File] " + linkURL)
            return Promise.resolve({name, downloaderArg: linkURL})
          }
        }).filter(Boolean)).then(items => ({items}))
      }),

      err => {
        console.warn("Failed to download: " + absURL)

        if (internals.attempts < maxAttempts) {
          console.warn(
            `Trying again. Attempt ${internals.attempts + 1}/${maxAttempts}...`
          )

          return crawl(absURL, opts, Object.assign({}, internals, {
            attempts: internals.attempts + 1
          }))
        } else {
          console.error(
            "We've hit the download attempt limit (" + maxAttempts + "). " +
            "Giving up on this path."
          )

          throw 'FAILED_DOWNLOAD'
        }
      }
    )
    .catch(error => {
      if (error === 'FAILED_DOWNLOAD') {
        // Debug logging for this is already handled above.
        return []
      } else {
        throw error
      }
    })
}

function getHTMLLinks(text) {
  // Never parse HTML with a regex!
  const $ = cheerio.load(text)

  return $('a').get().map(el => {
    const $el = $(el)
    return [$el.text(), $el.attr('href')]
  })
}

async function main(args) {
  if (args.length === 0) {
    console.log("Usage: crawl-http http://.../example/path/ [opts]")
    return
  }

  let url = args[0]

  let maxDownloadAttempts = 5
  let verbose = false
  let filterRegex = null

  await processArgv(args.slice(1), {
    '-max-download-attempts': function(util) {
      // --max-download-attempts <max>  (alias: -m)
      // Sets the maximum number of times to attempt downloading the index for
      // any one directory. Defaults to 5.

      maxDownloadAttempts = util.nextArg()
    },

    'm': util => util.alias('-max-download-attempts'),

    '-regex': function(util) {
      // --regex <regex>  (alias: -r)
      // Sets the regular expression string used for filtering specific URLs.
      // This regex is tested against every crawled URL. If the test matches,
      // the URL it is given is kept; otherwise it is skipped. Defaults to no
      // regex.

      filterRegex = new RegExp(util.nextArg())
    },

    'r': util => util.alias('-regex'),

    '-verbose': function(util) {
      // --verbose  (alias: -v)
      // Logs out extra verbose data about what files are being crawled and
      // such. Defaults to false.

      verbose = true
      console.log('Outputting verbosely.')
    },

    'v': util => util.alias('-verbose'),
  })

  const downloadedPlaylist = await crawl(url, {
    maxAttempts: maxDownloadAttempts,
    verbose: verbose,
    filterRegex: filterRegex
  })

  console.log(JSON.stringify(downloadedPlaylist, null, 2))
}

module.exports = main

if (require.main === module) {
  main(process.argv.slice(2))
    .catch(err => console.error(err))
}
