const fs = require('fs')
const processArgv = require('./process-argv')
const promisifyProcess = require('./promisify-process')
const { spawn } = require('child_process')
const { promisify } = require('util')
const { showTrackProcessStatus } = require('./general-util')
const { updatePlaylistFormat, flattenGrouplike } = require('./playlist-utils')

const readFile = promisify(fs.readFile)
const writeFile = promisify(fs.writeFile)

async function probe(filePath) {
  const ffprobe = spawn('ffprobe', [
    '-print_format', 'json',
    '-show_entries', 'stream=codec_name:format',
    '-select_streams', 'a:0',
    '-v', 'quiet',
    filePath
  ])

  let probeDataString = ''

  ffprobe.stdout.on('data', data => {
    probeDataString += data
  })

  await promisifyProcess(ffprobe, false)

  return JSON.parse(probeDataString)
}

async function main(args) {
  if (args.length < 2) {
    console.error('Usage: http-music process-metadata <in> <out> (..args..)')
    console.error('See \x1b[1mman http-music-process-metadata\x1b[0m!')
    return false
  }

  const inFile = args[0]
  const outFile = args[1]

  // Whether or not to save actual audio tag data. (This includes things like
  // genre, track #, and album, as well as any non-standard data set on the
  // file.)
  let saveTags = false

  // Whether or not to skip tracks which have already been processed.
  let skipCompleted = true

  await processArgv(args.slice(1), {
    '-save-tags': function() {
      saveTags = true
    },

    '-tags': util => util.alias('-save-tags'),
    't': util => util.alias('-save-tags'),

    '-skip-completed': function() {
      skipCompleted = true
    },

    '-skip-done': util => util.alias('-skip-completed'),
    '-faster': util => util.alias('-skip-completed'),

    '-no-skip-completed': function() {
      skipCompleted = false
    },

    '-no-skip-done': util => util.alias('-no-skip-completed'),
    '-slower': util => util.alias('-no-skip-completed')
  })

  let doneCount = 0

  const playlist = updatePlaylistFormat(JSON.parse(await readFile(args[0])))

  const flattened = flattenGrouplike(playlist)
  for (const item of flattened.items) {
    if (!(skipCompleted && 'metadata' in item)) {
      const probeData = await probe(item.downloaderArg)

      item.metadata = Object.assign(item.metadata || {}, {
        duration: parseInt(probeData.format.duration),
        size: parseInt(probeData.format.size),
        bitrate: parseInt(probeData.format.bit_rate)
      })

      if (saveTags) {
        item.metadata.tags = probeData.tags
      }
    }

    doneCount++
    showTrackProcessStatus(flattened.items.length, doneCount, true)
    process.stdout.write('   \r')
  }

  await writeFile(outFile, JSON.stringify(playlist, null, 2))

  console.log(`\nDone! Processed ${flattened.items.length} tracks.`)
}

module.exports = main

if (require.main === module) {
  main(process.argv.slice(2))
    .catch(err => console.error(err))
}
