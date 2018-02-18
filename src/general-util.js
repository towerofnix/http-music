const { promisify } = require('util')
const fs = require('fs')
const fetch = require('node-fetch')

const readFile = promisify(fs.readFile)

module.exports.showTrackProcessStatus = function(
  total, doneCount, noLineBreak = false
) {
  // Log a status line which tells how many tracks are processed and what
  // percent is completed. (Uses non-specific language: it doesn't say
  // "how many tracks downloaded" or "how many tracks processed", but
  // rather, "how many tracks completed".) Pass noLineBreak = true to skip
  // the \n character (you'll probably also want to log \r after).

  const percent = Math.trunc(doneCount / total * 10000) / 100
  process.stdout.write(
    `\x1b[1m${percent}% completed ` +
    `(${doneCount}/${total} tracks)\x1b[0m` +
    (noLineBreak ? '' : '\n')
  )
}

function downloadPlaylistFromURL(url) {
  return fetch(url).then(res => res.text())
}

function downloadPlaylistFromLocalPath(path) {
  return readFile(path)
}

module.exports.downloadPlaylistFromOptionValue = function(arg) {
  // TODO: Verify things!
  if (arg.startsWith('http://') || arg.startsWith('https://')) {
    return downloadPlaylistFromURL(arg)
  } else {
    return downloadPlaylistFromLocalPath(arg)
  }
}
