// Internal "crawler" that simply opens a file and returns the playlist stored
// in that file. This can also open web URLs; it uses the same code that the
// play option --open-playlist does.

const {
  downloadPlaylistFromOptionValue
} = require('./general-util')

function crawl(input) {
  return downloadPlaylistFromOptionValue(input)
}

async function main(args, shouldReturn = false) {
  if (args.length !== 1) {
    console.log("Usage: open-file /example/path.json")
    console.log("Note that open-file is generally supposed to be used as a 'source' argument!")
    console.log("So, for example, you could make a playlist that looks something like this:")
    console.log('{"items": [')
    console.log('  {"source": ["open-file", "jazz/playlist.json"]},')
    console.log('  {"source": ["open-file", "noise/playlist.json"]}')
    console.log(']}')
    return
  }

  const playlist = await crawl(args[0])

  const str = JSON.stringify(playlist, null, 2)
  if (shouldReturn) {
    return str
  } else {
    console.log(str)
  }
}

module.exports = {crawl, main}
