#!/usr/bin/env node

'use strict'

const fetch = require('node-fetch')
const $ = require('cheerio')
const url = require('url')
const path = require('path')
const processArgv = require('./process-argv')

function crawl(absURL, maxAttempts = 5, attempts = 0) {
  // Recursively crawls a given URL, following every link to a deeper path and
  // recording all links in a tree (in the same format playlists use). Makes
  // multiple attempts to download failed paths.

  return fetch(absURL)
    .then(
      res => res.text().then(text => {
        const links = getHTMLLinks(text)
        const verbose = process.argv.includes('--verbose')

        return Promise.all(links.map(link => {
          const [ title, href ] = link
          const linkURL = url.format(new url.URL(href, absURL))

          if (href.endsWith('/')) {
            // It's a directory!

            if (verbose) console.log("[Dir] " + linkURL)
            return crawl(linkURL, maxAttempts)
              .then(res => [title, res])
          } else {
            // It's a file!

            if (verbose) console.log("[File] " + linkURL)
            return Promise.resolve([title, linkURL])
          }
        }))
      }),

      err => {
        console.warn("Failed to download: " + absURL)

        if (attempts < maxAttempts) {
          console.warn(
            `Trying again. Attempt ${attempts + 1}/${maxAttempts}...`
          )

          return crawl(absURL, maxAttempts, attempts + 1)
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

  return $(text).find('a').get().map(a => {
    const $a = $(a)
    return [$a.text(), $a.attr('href')]
  })
}

async function main() {
  let url = process.argv[2]

  let maxDownloadAttempts = 5

  await processArgv(process.argv.slice(3), {
    '-max-download-attempts': function(util) {
      // --max-download-attempts <max>  (alias: -m)
      // Sets the maximum number of times to attempt downloading the index for
      // any one directory. Defaults to 5.

      maxDownloadAttempts = util.nextArg()
      console.log(maxDownloadAttempts)
    },

    'm': util => util.alias('-max-download-attempts')
  })

  const downloadedPlaylist = await crawl(url, maxDownloadAttempts)

  return JSON.stringify(res, null, 2)
}

if (process.argv.length === 2) {
  console.log("Usage: http-music-crawl-http http://.../example/path/ [opts]")
} else {
  main()
    .catch(err => console.error(err))
}
