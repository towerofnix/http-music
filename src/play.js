#!/usr/bin/env node

'use strict'

const { promisify } = require('util')
const clone = require('clone')
const fs = require('fs')
const fetch = require('node-fetch')
const commandExists = require('./command-exists')
const pickers = require('./pickers')
const loopPlay = require('./loop-play')
const processArgv = require('./process-argv')
const processSmartPlaylist = require('./smart-playlist')

const {
  filterPlaylistByPathString, removeGroupByPathString, getPlaylistTreeString,
  updatePlaylistFormat
} = require('./playlist-utils')

const readFile = promisify(fs.readFile)
const writeFile = promisify(fs.writeFile)

function downloadPlaylistFromURL(url) {
  return fetch(url).then(res => res.text())
}

function downloadPlaylistFromLocalPath(path) {
  return readFile(path)
}

function downloadPlaylistFromOptionValue(arg) {
  // TODO: Verify things!
  if (arg.startsWith('http://') || arg.startsWith('https://')) {
    return downloadPlaylistFromURL(arg)
  } else {
    return downloadPlaylistFromLocalPath(arg)
  }
}

function clearConsoleLine() {
  process.stdout.write('\x1b[1K\r')
}

async function determineDefaultPlayer() {
  if (await commandExists('mpv')) {
    return 'mpv'
  } else if (await commandExists('play')) {
    return 'play'
  } else {
    return null
  }
}

async function main(args) {
  let sourcePlaylist = null
  let activePlaylist = null

  let pickerType = 'shuffle'
  let playerCommand = await determineDefaultPlayer()
  let playOpts = []

  // WILL play says whether the user has forced playback via an argument.
  // SHOULD play says whether the program has automatically decided to play
  // or not, if the user hasn't set WILL play.
  let shouldPlay = true
  let willPlay = null

  async function openPlaylist(arg, silent = false) {
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

    const openedPlaylist = updatePlaylistFormat(JSON.parse(playlistText))

    // We also want to de-smart-ify (stupidify? - simplify?) the playlist.
    const processedPlaylist = await processSmartPlaylist(openedPlaylist)

    // The active playlist is a clone of the source playlist; after all it's
    // quite possible we'll be messing with the value of the active playlist,
    // and we don't want to reflect those changes in the source playlist.
    sourcePlaylist = processedPlaylist
    activePlaylist = clone(processedPlaylist)

    processArgv(processedPlaylist.options, optionFunctions)
  }

  function requiresOpenPlaylist() {
    if (activePlaylist === null) {
      throw new Error(
        "This action requires an open playlist - try --open (file)"
      )
    }
  }

  const optionFunctions = {
    '-help': function(util) {
      // --help  (alias: -h, -?)
      // Presents a help message.

      console.log('http-music\nTry man http-music!')

      if (util.index === util.argv.length - 1) {
        shouldPlay = false
      }
    },

    'h': util => util.alias('-help'),
    '?': util => util.alias('-help'),

    '-open-playlist': async function(util) {
      // --open-playlist <file>  (alias: --open, -o)
      // Opens a separate playlist file.
      // This sets the source playlist.

      await openPlaylist(util.nextArg())
    },

    '-open': util => util.alias('-open-playlist'),
    'o': util => util.alias('-open-playlist'),

    '-write-playlist': function(util) {
      // --write-playlist <file>  (alias: --write, -w, --save)
      // Writes the active playlist to a file. This file can later be used
      // with --open <file>; you won't need to stick in all the filtering
      // options again.

      requiresOpenPlaylist()

      const playlistString = JSON.stringify(activePlaylist, null, 2)
      const file = util.nextArg()

      console.log(`Saving playlist to file ${file}...`)

      return writeFile(file, playlistString).then(() => {
        console.log("Saved.")

        // If this is the last option, the user probably doesn't actually
        // want to play the playlist. (We need to check if this is len - 2
        // rather than len - 1, because of the <file> option that comes
        // after --write-playlist.)
        if (util.index === util.argv.length - 2) {
          shouldPlay = false
        }
      })
    },

    '-write': util => util.alias('-write-playlist'),
    'w': util => util.alias('-write-playlist'),
    '-save': util => util.alias('-write-playlist'),

    '-print-playlist': function(util) {
      // --print-playlist  (alias: --log-playlist, --json)
      // Prints out the JSON representation of the active playlist.

      requiresOpenPlaylist()

      console.log(JSON.stringify(activePlaylist, null, 2))

      // As with --write-playlist, the user probably doesn't want to actually
      // play anything if this is the last option.
      if (util.index === util.argv.length - 1) {
        shouldPlay = false
      }
    },

    '-log-playlist': util => util.alias('-print-playlist'),
    '-json': util => util.alias('-print-playlist'),

    '-clear': function(util) {
      // --clear  (alias: -c)
      // Clears the active playlist. This does not affect the source
      // playlist.

      requiresOpenPlaylist()

      activePlaylist.items = []
    },

    'c': util => util.alias('-clear'),

    '-keep': function(util) {
      // --keep <groupPath>  (alias: -k)
      // Keeps a group by loading it from the source playlist into the
      // active playlist. This is usually useful after clearing the
      // active playlist; it can also be used to keep a subgroup when
      // you've removed an entire parent group, e.g. `-r foo -k foo/baz`.

      requiresOpenPlaylist()

      const pathString = util.nextArg()
      const group = filterPlaylistByPathString(sourcePlaylist, pathString)
      activePlaylist.items.push(group)
    },

    'k': util => util.alias('-keep'),

    '-remove': function(util) {
      // --remove <groupPath>  (alias: -r, -x)
      // Filters the playlist so that the given path is removed.

      requiresOpenPlaylist()

      const pathString = util.nextArg()
      console.log("Ignoring path: " + pathString)
      removeGroupByPathString(activePlaylist, pathString)
    },

    'r': util => util.alias('-remove'),
    'x': util => util.alias('-remove'),

    '-list-groups': function(util) {
      // --list-groups  (alias: -l, --list)
      // Lists all groups in the playlist.

      requiresOpenPlaylist()

      console.log(getPlaylistTreeString(activePlaylist))

      // If this is the last item in the argument list, the user probably
      // only wants to get the list, so we'll mark the 'should run' flag
      // as false.
      if (util.index === util.argv.length - 1) {
        shouldPlay = false
      }
    },

    '-list': util => util.alias('-list-groups'),
    'l': util => util.alias('-list-groups'),

    '-list-all': function(util) {
      // --list-all  (alias: --list-tracks, -L)
      // Lists all groups and tracks in the playlist.

      requiresOpenPlaylist()

      console.log(getPlaylistTreeString(activePlaylist, true))

      // As with -l, if this is the last item in the argument list, we
      // won't actually be playing the playlist.
      if (util.index === util.argv.length - 1) {
        shouldPlay = false
      }
    },

    '-list-tracks': util => util.alias('-list-all'),
    'L': util => util.alias('-list-all'),

    '-play': function(util) {
      // --play  (alias: -p)
      // Forces the playlist to actually play.

      willPlay = true
    },

    'p': util => util.alias('-play'),

    '-no-play': function(util) {
      // --no-play  (alias: -np)
      // Forces the playlist not to play.

      willPlay = false
    },

    'np': util => util.alias('-no-play'),

    '-picker': function(util) {
      // --picker <picker type>  (alias: --selector)
      // Selects the mode that the song to play is picked.
      // See pickers.js.

      pickerType = util.nextArg()
    },

    '-selector': util => util.alias('-picker'),

    '-player': function(util) {
      // --player <player>
      // Sets the shell command by which audio is played.
      // Valid options include 'sox' (or 'play') and 'mpv'. Use whichever is
      // installed on your system.

      playerCommand = util.nextArg()
    }
  }

  await openPlaylist('./playlist.json', true)

  await processArgv(args, optionFunctions)

  if (activePlaylist === null) {
    throw new Error(
      "Cannot play - no open playlist. Try --open <playlist file>?"
    )
  }

  if (willPlay || (willPlay === null && shouldPlay)) {
    let picker
    if (pickerType === 'shuffle') {
      console.log("Using shuffle picker.")
      picker = pickers.makeShufflePlaylistPicker(activePlaylist)
    } else if (pickerType === 'ordered') {
      console.log("Using ordered picker.")
      picker = pickers.makeOrderedPlaylistPicker(activePlaylist)
    } else {
      console.error("Invalid picker type: " + pickerType)
      return
    }

    console.log(`Using ${playerCommand} player.`)

    const {
      promise: playPromise,
      playController,
      downloadController,
      player
    } = loopPlay(activePlaylist, picker, playerCommand, playOpts)

    // We're looking to gather standard input one keystroke at a time.
    // But that isn't *always* possible, e.g. when piping into the http-music
    // command through the shell.
    if ('setRawMode' in process.stdin) {
      process.stdin.setRawMode(true)
    } else {
      console.warn("User input cannot be gotten!")
      console.warn("If you're piping into http-music, this is normal.")
    }

    process.stdin.on('data', data => {
      const escModifier = Buffer.from('\x1b[')
      const shiftModifier = Buffer.from('1;2')

      const esc = num => Buffer.concat([escModifier, Buffer.from([num])])

      const shiftEsc = num => (
        Buffer.concat([escModifier, shiftModifier, Buffer.from([num])])
      )

      const equalsChar = char => (
        Buffer.from(char.toLowerCase()).equals(data) ||
        Buffer.from(char.toUpperCase()).equals(data)
      )

      if (Buffer.from([0x20]).equals(data)) {
        player.togglePause()
      }

      if (esc(0x43).equals(data)) {
        player.seekAhead(5)
      }

      if (esc(0x44).equals(data)) {
        player.seekBack(5)
      }

      if (shiftEsc(0x43).equals(data)) {
        player.seekAhead(30)
      }

      if (shiftEsc(0x44).equals(data)) {
        player.seekBack(30)
      }

      if (esc(0x41).equals(data)) {
        player.volUp(10)
      }

      if (esc(0x42).equals(data)) {
        player.volDown(10)
      }

      if (equalsChar('s')) {
        clearConsoleLine()
        console.log(
          "Skipping the track that's currently playing. " +
          "(Press I for track info!)"
        )

        playController.skip()
      }

      if (Buffer.from([0x7f]).equals(data)) {
        clearConsoleLine()
        console.log(
          "Skipping the track that's up next. " +
          "(Press I for track info!)"
        )

        playController.skipUpNext()
      }

      if (equalsChar('i') || equalsChar('t')) {
        clearConsoleLine()
        playController.logTrackInfo()
      }

      if (
        equalsChar('q') ||
        Buffer.from('q').equals(data) ||
        Buffer.from([0x03]).equals(data) || // ^C
        Buffer.from([0x04]).equals(data) // ^D
      ) {
        playController.stop().then(() => {
          process.exit(0)
        })
      }
    })

    return playPromise
  } else {
    return activePlaylist
  }
}

module.exports = main

if (require.main === module) {
  main(process.argv.slice(2))
    .catch(err => console.error(err))
}
