const { promisify } = require('util')
const fs = require('fs')
const fetch = require('node-fetch')
const clone = require('clone')
const processArgv = require('./process-argv')
const { processSmartPlaylist } = require('./smart-playlist')

const readFile = promisify(fs.readFile)
const writeFile = promisify(fs.writeFile)

// TODO: Check which of these are actually used. For now stolen from play.js,
// along with the zillion functions that use at least some of these.
const {
  filterPlaylistByPathString, removeGroupByPathString, getPlaylistTreeString,
  updatePlaylistFormat, collapseGrouplike, filterGrouplikeByProperty, isTrack,
  flattenGrouplike
} = require('./playlist-utils')

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
  return readFile(path).then(buf => buf.toString())
}

function downloadPlaylistFromOptionValue (arg) {
  // TODO: Verify things!
  if (arg.startsWith('http://') || arg.startsWith('https://')) {
    return downloadPlaylistFromURL(arg)
  } else {
    return downloadPlaylistFromLocalPath(arg)
  }
}

Object.assign(module.exports, {
  downloadPlaylistFromOptionValue
})

module.exports.makePlaylistOptions = function() {
  let sourcePlaylist = null
  let activePlaylist = null

  // Whether or not a playlist has been opened yet. This is just used to
  // decide when exactly to load the default playlist. (We don't want to load
  // it as soon as the process starts, since there might be an --open-playlist
  // option that specifies opening a *different* playlist! But if we encounter
  // an action that requires a playlist, and no playlist has yet been opened,
  // we assume that the user probably wants to do something with the default
  // playlist, and that's when we open it. See requiresOpenPlaylist for the
  // implementation of this.)
  let hasOpenedPlaylist = false

  const openPlaylist = async function (arg, silent = false) {
    // Takes a playlist download argument and loads it as the source and
    // active playlist.

    let playlistText

    if (!silent) {
      console.log("Opening playlist from: " + arg)
    }

    try {
      playlistText = await downloadPlaylistFromOptionValue(arg)
    } catch(err) {
      if (!silent) {
        console.error("Failed to open playlist file: " + arg)
        console.error(err)
      }

      return false
    }

    const importedPlaylist = JSON.parse(playlistText)

    hasOpenedPlaylist = true

    await loadPlaylist(importedPlaylist)
  }

  const loadPlaylist = async function (importedPlaylist) {
    // Takes an actual playlist object and sets it up as the source and active
    // playlist.

    // We want to de-smart-ify (stupidify? - simplify?) the playlist.
    // This also automatically updates the playlist format for us, which is
    // handy.
    sourcePlaylist = await processSmartPlaylist(importedPlaylist)

    // The active playlist is a clone of the source playlist; after all it's
    // quite possible we'll be messing with the value of the active playlist,
    // and we don't want to reflect those changes in the source playlist.
    activePlaylist = clone(sourcePlaylist)

    await processArgv(sourcePlaylist.options, optionFunctions)
  }

  const requiresOpenPlaylist = async function() {
    if (activePlaylist === null) {
      if (hasOpenedPlaylist === false) {
        await openDefaultPlaylist()
      } else {
        throw new Error(
          "This action requires an open playlist - try --open (file)"
        )
      }
    }
  }

  const openDefaultPlaylist = function() {
    return openPlaylist('./playlist.json', true)
  }

  const optionFunctions = {
    '-open-playlist': async function(util) {
      // --open-playlist <file>  (alias: --open, -o)
      // Opens a separate playlist file.
      // This sets the source playlist.

      await openPlaylist(util.nextArg())
    },

    '-open': util => util.alias('-open-playlist'),
    'o': util => util.alias('-open-playlist'),

    '-open-playlist-string': async function(util) {
      // --open-playlist-string <string>
      // Opens a playlist, using the given string as the JSON text of the
      // playlist. This sets the source playlist.

      await loadPlaylist(JSON.parse(util.nextArg()))
    },

    '-playlist-string': util => util.alias('-open-playlist-string'),

    '-write-playlist': async function(util) {
      // --write-playlist <file>  (alias: --write, -w, --save)
      // Writes the active playlist to a file. This file can later be used
      // with --open <file>; you won't need to stick in all the filtering
      // options again.

      await requiresOpenPlaylist()

      const playlistString = JSON.stringify(activePlaylist, null, 2)
      const file = util.nextArg()

      console.log(`Saving playlist to file ${file}...`)

      await writeFile(file, playlistString)

      console.log("Saved.")
    },

    '-write': util => util.alias('-write-playlist'),
    'w': util => util.alias('-write-playlist'),
    '-save': util => util.alias('-write-playlist'),

    '-print-playlist': async function(util) {
      // --print-playlist  (alias: --log-playlist, --json)
      // Prints out the JSON representation of the active playlist.

      await requiresOpenPlaylist()

      console.log(JSON.stringify(activePlaylist, null, 2))
    },

    '-log-playlist': util => util.alias('-print-playlist'),
    '-json': util => util.alias('-print-playlist'),

    '-clear': async function(util) {
      // --clear  (alias: -c)
      // Clears the active playlist. This does not affect the source
      // playlist.

      await requiresOpenPlaylist()

      activePlaylist.items = []
    },

    'c': util => util.alias('-clear'),

    '-keep': async function(util) {
      // --keep <groupPath>  (alias: -k)
      // Keeps a group by loading it from the source playlist into the
      // active playlist. This is usually useful after clearing the
      // active playlist; it can also be used to keep a subgroup when
      // you've removed an entire parent group, e.g. `-r foo -k foo/baz`.

      await requiresOpenPlaylist()

      const pathString = util.nextArg()
      const group = filterPlaylistByPathString(sourcePlaylist, pathString)

      if (group) {
        activePlaylist.items.push(group)
      }
    },

    'k': util => util.alias('-keep'),

    '-remove': async function(util) {
      // --remove <groupPath>  (alias: -r, -x)
      // Filters the playlist so that the given path is removed.

      await requiresOpenPlaylist()

      const pathString = util.nextArg()
      console.log("Ignoring path: " + pathString)
      removeGroupByPathString(activePlaylist, pathString)
    },

    'r': util => util.alias('-remove'),
    'x': util => util.alias('-remove'),

    '-filter': async function(util) {
      // --filter <filterJSON>
      // Filters the playlist so that only tracks that match the given filter
      // are kept. FilterJSON should be a JSON object as described in the
      // man page section "filters".

      const filterJSON = util.nextArg()

      let filterObj
      try {
        filterObj = JSON.parse(filterJSON)
      } catch (error) {
        console.error('Invalid JSON for filter:', filterJSON)
        return
      }

      activePlaylist.filters = [filterObj]
      activePlaylist = await processSmartPlaylist(activePlaylist)
      activePlaylist = updatePlaylistFormat(activePlaylist)
    },

    'f': util => util.alias('-filter'),

    '-collapse-groups': async function() {
      // --collapse-groups  (alias: --collapse)
      // Collapses groups in the active playlist so that there is only one
      // level of sub-groups. Handy for shuffling the order groups play in;
      // try `--collapse-groups --sort shuffle-groups`.

      await requiresOpenPlaylist()

      activePlaylist = updatePlaylistFormat(collapseGrouplike(activePlaylist))
    },

    '-collapse': util => util.alias('-collapse-groups'),

    '-flatten-tracks': async function() {
      // --flatten-tracks  (alias: --flatten)
      // Flattens the entire active playlist, so that only tracks remain,
      // and there are no groups.

      await requiresOpenPlaylist()

      activePlaylist = updatePlaylistFormat(flattenGrouplike(activePlaylist))
    },

    '-flatten': util => util.alias('-flatten-tracks'),

    '-list-groups': async function(util) {
      // --list-groups  (alias: -l, --list)
      // Lists all groups in the playlist.

      await requiresOpenPlaylist()

      console.log(getPlaylistTreeString(activePlaylist))
    },

    '-list': util => util.alias('-list-groups'),
    'l': util => util.alias('-list-groups'),

    '-list-all': async function(util) {
      // --list-all  (alias: --list-tracks, -L)
      // Lists all groups and tracks in the playlist.

      await requiresOpenPlaylist()

      console.log(getPlaylistTreeString(activePlaylist, true))

    },

    '-list-tracks': util => util.alias('-list-all'),
    'L': util => util.alias('-list-all'),
  }

  return {
    optionFunctions,
    openDefaultPlaylist,
    getStuff: {
      get hasOpenedPlaylist() { return hasOpenedPlaylist },
      get activePlaylist() { return activePlaylist }
    }
  }
}

module.exports.processTemplateString = function(string, replacements) {
  let outString = ''
  let currentReplacement = null
  for (let i = 0; i < string.length; i++) {
    const char = string[i]

    if (char === '%') {
      if (currentReplacement === null) {
        currentReplacement = ''
      } else {
        if (Object.keys(replacements).includes(currentReplacement)) {
          outString += replacements[currentReplacement].toString()
        } else {
          outString += '%UnknownKey:' + currentReplacement + '%'
        }
        currentReplacement = null
      }
    } else {
      if (currentReplacement === null) {
        outString += char
      } else {
        currentReplacement += char
      }
    }
  }
  return outString
}
