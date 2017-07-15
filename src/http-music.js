#!/usr/bin/env node

'use strict'

const { promisify } = require('util')
const fs = require('fs')
const pickers = require('./pickers')
const loopPlay = require('./loop-play')
const processArgv = require('./process-argv')
const fetch = require('node-fetch')

const {
  filterPlaylistByPathString, removeGroupByPathString, getPlaylistTreeString,
  updatePlaylistFormat
} = require('./playlist-utils')

const readFile = promisify(fs.readFile)

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

Promise.resolve()
  .then(async () => {
    let sourcePlaylist = null
    let activePlaylistGroup = null

    let pickerType = 'shuffle'
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

      sourcePlaylist = openedPlaylist
      activePlaylistGroup = {items: openedPlaylist.items}

      processArgv(openedPlaylist.options, optionFunctions)
    }

    function requiresOpenPlaylist() {
      if (activePlaylistGroup === null) {
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

      '-open': async function(util) {
        // --open <file>  (alias: -o)
        // Opens a separate playlist file.
        // This sets the source playlist.

        await openPlaylist(util.nextArg())
      },

      'o': util => util.alias('-open'),

      '-clear': function(util) {
        // --clear  (alias: -c)
        // Clears the active playlist. This does not affect the source
        // playlist.

        requiresOpenPlaylist()

        activePlaylistGroup = []
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
        activePlaylistGroup.push(group)
      },

      'k': util => util.alias('-keep'),

      '-remove': function(util) {
        // --remove <groupPath>  (alias: -r, -x)
        // Filters the playlist so that the given path is removed.

        requiresOpenPlaylist()

        const pathString = util.nextArg()
        console.log("Ignoring path: " + pathString)
        removeGroupByPathString(activePlaylistGroup, pathString)
      },

      'r': util => util.alias('-remove'),
      'x': util => util.alias('-remove'),

      '-list-groups': function(util) {
        // --list-groups  (alias: -l, --list)
        // Lists all groups in the playlist.

        requiresOpenPlaylist()

        console.log(getPlaylistTreeString(activePlaylistGroup))

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

        console.log(getPlaylistTreeString(activePlaylistGroup, true))

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

      '-play-opts': function(util) {
        // --play-opts <opts>
        // Sets command line options passed to the `play` command.

        playOpts = util.nextArg().split(' ')
      },

      '-debug-list': function(util) {
        // --debug-list
        // Prints out the JSON representation of the active playlist.

        requiresOpenPlaylist()

        console.log(JSON.stringify(activePlaylistGroup, null, 2))
      }
    }

    await openPlaylist('./playlist.json', true)

    await processArgv(process.argv, optionFunctions)

    if (activePlaylistGroup === null) {
      throw new Error(
        "Cannot play - no open playlist. Try --open <playlist file>?"
      )
    }

    if (willPlay || (willPlay === null && shouldPlay)) {
      let picker
      if (pickerType === 'shuffle') {
        console.log("Using shuffle picker.")
        picker = pickers.makeShufflePlaylistPicker(activePlaylistGroup)
      } else if (pickerType === 'ordered') {
        console.log("Using ordered picker.")
        picker = pickers.makeOrderedPlaylistPicker(activePlaylistGroup)
      } else {
        console.error("Invalid picker type: " + pickerType)
        return
      }

      const {
        promise: playPromise,
        playController: play,
        downloadController
      } = loopPlay(picker, playOpts)

      // We're looking to gather standard input one keystroke at a time.
      process.stdin.setRawMode(true)

      process.stdin.on('data', data => {
        const escModifier = Buffer.from('\x1b[')
        const shiftModifier = Buffer.from('1;2')

        const esc = num => Buffer.concat([escModifier, Buffer.from([num])])

        const shiftEsc = num => (
          Buffer.concat([escModifier, shiftModifier, Buffer.from([num])])
        )

        if (Buffer.from([0x20]).equals(data)) {
          play.togglePause()
        }

        if (esc(0x43).equals(data)) {
          play.seekAhead(5)
        }

        if (esc(0x44).equals(data)) {
          play.seekBack(5)
        }

        if (shiftEsc(0x43).equals(data)) {
          play.seekAhead(30)
        }

        if (shiftEsc(0x44).equals(data)) {
          play.seekBack(30)
        }

        if (esc(0x41).equals(data)) {
          play.volUp(10)
        }

        if (esc(0x42).equals(data)) {
          play.volDown(10)
        }

        if (Buffer.from('s').equals(data)) {
          clearConsoleLine()
          console.log(
            "Skipping the track that's currently playing. " +
            "(Press I for track info!)"
          )

          play.skip()
        }

        if (Buffer.from([0x7f]).equals(data)) {
          clearConsoleLine()
          console.log(
            "Skipping the track that's up next. " +
            "(Press I for track info!)"
          )

          // TODO: It would be nice to have this as a method of
          // PlayController.
          downloadController.cancel()
          play.startNextDownload()
        }

        if (
          Buffer.from('i').equals(data) ||
          Buffer.from('t').equals(data)
        ) {
          clearConsoleLine()
          play.logTrackInfo()
        }

        if (
          Buffer.from('q').equals(data) ||
          Buffer.from([0x03]).equals(data) || // ^C
          Buffer.from([0x04]).equals(data) // ^D
        ) {
          play.kill()
          process.stdout.write('\n')
          process.exit(0)
        }
      })

      return playPromise
    } else {
      return activePlaylistGroup
    }
  })
  .catch(err => console.error(err))

function clearConsoleLine() {
  process.stdout.write('\x1b[1K\r')
}
