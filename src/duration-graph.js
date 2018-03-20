'use strict'

const fs = require('fs')
const util = require('util')
const processArgv = require('./process-argv')

const {
  updatePlaylistFormat,
  isGroup, isItem,
  getItemPathString,
  flattenGrouplike
} = require('./playlist-utils')

const { makePlaylistOptions } = require('./general-util')

const readFile = util.promisify(fs.readFile)

const metrics = {}
metrics.duration = Symbol('Duration')
metrics.length = metrics.duration
metrics.time = metrics.duration
metrics.tracks = Symbol('# of tracks')
metrics.items = metrics.tracks

function getUncachedDurationOfItem(item) {
  if (isGroup(item)) {
    return item.items.reduce((a, b) => a + getDurationOfItem(b), 0)
  } else {
    if (item && item.metadata && item.metadata.duration) {
      return item.metadata.duration
    } else {
      console.warn('Item missing metadata:', getItemPathString(item))
      return 0
    }
  }
}

// This is mostly just to avoid logging out "item missing metadata" warnings
// multiple times.
function getDurationOfItem(item) {
  if (metrics.duration in item === false) {
    item[metrics.duration] = getUncachedDurationOfItem(item)
  }

  return item[metrics.duration]
}

function getTrackCount(item) {
  if (metrics.tracks in item === false) {
    if (isGroup(item)) {
      item[metrics.tracks] = flattenGrouplike(item).items.length
    } else {
      item[metrics.tracks] = 1
    }
  }

  return item[metrics.tracks]
}

const getHours = n => Math.floor(n / 3600)
const getMinutes = n => Math.floor((n % 3600) / 60)
const getSeconds = n => n % 60

function wordFormatDuration(durationNumber) {
  if (typeof durationNumber !== 'number') {
    throw new Error('Non-number passed')
  }

  // oh yeah
  const hours = getHours(durationNumber),
        minutes = getMinutes(durationNumber),
        seconds = getSeconds(durationNumber)

  return [
    hours ? `${hours} hours` : false,
    minutes ? `${minutes} minutes` : false,
    seconds ? `${seconds} seconds` : false
  ].filter(Boolean).join(', ') || '(No length.)'
}

function digitalFormatDuration(durationNumber) {
  if (typeof durationNumber !== 'number') {
    throw new Error('Non-number passed')
  }

  const hours = getHours(durationNumber),
        minutes = getMinutes(durationNumber),
        seconds = getSeconds(durationNumber)

  return [hours, minutes, seconds].filter(Boolean).length ? [
    hours ? `${hours}` : false,
    minutes ? `${minutes}`.padStart(2, '0') : '00',
    seconds ? `${seconds}`.padStart(2, '0') : '00'
  ].filter(Boolean).join(':') : '(No length.)'
}

function padStartList(strings) {
  const len = strings.reduce((a, b) => Math.max(a, b.length), 0)
  return strings.map(s => s.padStart(len, ' '))
}

function measureItem(item, metric) {
  if (metric === metrics.duration) {
    return getDurationOfItem(item)
  } else if (metric === metrics.tracks) {
    return getTrackCount(item)
  } else {
    throw new Error('Invalid metric: ' + metric)
  }
}

function makePlaylistGraph(playlist, {
  graphWidth = 60,
  onlyFirst = 20,
  metric = metrics.duration
} = {}) {
  const output = []

  const wholePlaylistLength = measureItem(playlist, metric)

  const briefFormatDuration = duration => {
    if (metric === metrics.duration) {
      return digitalFormatDuration(duration)
    } else {
      return duration.toString()
    }
  }

  const longFormatDuration = duration => {
    if (metric === metrics.duration) {
      return wordFormatDuration(duration)
    } else if (metric === metrics.tracks) {
      return `${duration} tracks`
    } else {
      return duration.toString()
    }
  }

  let topThings = playlist.items.map((item, i) => {
    const duration = measureItem(item, metric)
    const briefDuration = briefFormatDuration(duration)
    return {item, duration, briefDuration}
  })

  topThings.sort((a, b) => b.duration - a.duration)

  const ignoredThings = topThings.slice(onlyFirst)

  topThings = topThings.slice(0, onlyFirst)

  const displayLength = topThings.reduce((a, b) => a + b.duration, 0)

  // Left-pad the brief durations so they're all the same length.
  {
    const len = topThings.reduce((a, b) => Math.max(a, b.briefDuration.length), 0)
    for (const obj of topThings) {
      obj.padDuration = obj.briefDuration.padStart(len, ' ')
    }
  }

  let totalWidth = 0
  for (let i = 0; i < topThings.length; i++) {
    // Add a color to each item.
    const colorCode = (i % 6) + 1
    topThings[i].fgColor = `\x1b[3${colorCode}m`
    topThings[i].bgColor = `\x1b[4${colorCode}m`

    topThings[i].partOfWhole = 1 / displayLength * topThings[i].duration

    let w = Math.floor(topThings[i].partOfWhole * graphWidth)
    if (totalWidth < graphWidth) {
      w = Math.max(1, w)
    }
    totalWidth += w
    topThings[i].visualWidth = w
  }

  output.push('    Whole length: ' + longFormatDuration(wholePlaylistLength), '')

  output.push('    ' + topThings.map(({ bgColor, fgColor, visualWidth }) => {
    return bgColor + fgColor + '-'.repeat(visualWidth)
  }).join('') + '\x1b[0m' + (ignoredThings.length ? ' *' : ''), '')

  output.push('    Length by item:')

  output.push(...topThings.map(({ item, padDuration, visualWidth, fgColor }) =>
    `    ${fgColor}${
      // Dim the row if it doesn't show up in the graph.
      visualWidth === 0 ? '\x1b[2m- ' : '  '
    }${padDuration}  ${item.name}\x1b[0m`
  ))

  if (ignoredThings.length) {
    const totalDuration = ignoredThings.reduce((a, b) => a + b.duration, 0)
    const dur = longFormatDuration(totalDuration)
    output.push(
      `    \x1b[2m(* Plus ${ignoredThings.length} skipped items, accounting `,
      `       for ${dur}.)\x1b[0m`
    )
  }

  if (topThings.some(x => x.visualWidth === 0)) {
    output.push('',
      '    (Items that are too short to show up on the',
      '     visual graph are dimmed and marked with a -.)'
    )
  }

  return output
}

async function main(args) {
  if (args.length === 0) {
    console.log("Usage: http-music duration-graph /path/to/processed-playlist.json")
    return
  }

  let graphWidth = 60
  let onlyFirst = 20
  let metric = metrics.duration

  const { optionFunctions, getStuff } = makePlaylistOptions()

  Object.assign(optionFunctions, {
    '-metric': util => {
      const arg = util.nextArg()
      if (Object.keys(metrics).includes(arg)) {
        metric = metrics[arg]
      } else {
        console.warn('Didn\'t set metric because it isn\'t recognized:', arg)
      }
    },

    '-measure': util => util.alias('-metric'),
    'm': util => util.alias('-metric'),

    '-graph-width': util => {
      const arg = util.nextArg()
      const newVal = parseInt(arg)
      if (newVal > 0) {
        graphWidth = newVal
      } else {
        console.warn('Didn\'t set graph width because it\'s not greater than 0:', arg)
      }
    },

    '-width': util => util.alias('-graph-width'),
    'w': util => util.alias('-graph-width'),

    '-only-first': util => {
      const arg = util.nextArg()
      const newVal = parseInt(arg)
      if (newVal > 0) {
        onlyFirst = newVal
      } else {
        console.warn('You can\'t use the first *zero* tracks! -', arg)
      }
    },

    '-first': util => util.alias('-only-first'),

    '-all': util => {
      onlyFirst = Infinity
    }
  })

  await processArgv(args, optionFunctions)

  const playlist = getStuff.activePlaylist

  console.log(playlist)

  for (const line of makePlaylistGraph(playlist, {
    graphWidth, onlyFirst, metric
  })) {
    console.log(line)
  }
}

module.exports = main
