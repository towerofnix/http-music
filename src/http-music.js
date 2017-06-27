#!/usr/bin/env node

'use strict'

const { promisify } = require('util')
const fs = require('fs')
const pickers = require('./pickers')
const loopPlay = require('./loop-play')
const processArgv = require('./process-argv')

const {
  filterPlaylistByPathString, removeGroupByPathString, getPlaylistTreeString
} = require('./playlist-utils')

const readFile = promisify(fs.readFile)

Promise.resolve()
  .then(async () => {
    let sourcePlaylist = null
    let activePlaylist = null

    let pickerType = 'shuffle'
    let playOpts = []

    // WILL play says whether the user has forced playback via an argument.
    // SHOULD play says whether the program has automatically decided to play
    // or not, if the user hasn't set WILL play.
    let shouldPlay = true
    let willPlay = null

    async function openPlaylist(file, silent = false) {
      let playlistText

      try {
        playlistText = await readFile(file, 'utf-8')
      } catch(err) {
        if (!silent) {
          console.error("Failed to read playlist file: " + file)
        }

        return false
      }

      const openedPlaylist = JSON.parse(playlistText)

      // Playlists can be in two formats...
      if (Array.isArray(openedPlaylist)) {
        // ..the first, a simple array of tracks and groups;

        sourcePlaylist = openedPlaylist
        activePlaylist = openedPlaylist
      } else if (typeof openedPlaylist === 'object') {
        // ..or an object including metadata and configuration as well as the
        // array described in the first.

        if (!('tracks' in openedPlaylist)) {
          throw new Error(
            "Trackless object-type playlist (requires 'tracks' property)"
          )
        }

        sourcePlaylist = openedPlaylist.tracks
        activePlaylist = openedPlaylist.tracks

        // What's handy about the object-type playlist is that you can pass
        // options that will be run every time the playlist is opened:
        if ('options' in openedPlaylist) {
          if (Array.isArray(openedPlaylist.options)) {
            processArgv(openedPlaylist.options, optionFunctions)
          } else {
            throw new Error(
              "Invalid 'options' property (expected array): " + file
            )
          }
        }
      } else {
        // Otherwise something's gone horribly wrong..!
        throw new Error("Invalid playlist file contents: " + file)
      }
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

        activePlaylist = []
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
        activePlaylist.push(group)
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
        // --picker <picker type>
        // Selects the mode that the song to play is picked.
        // See pickers.js.

        pickerType = util.nextArg()
      },

      '-play-opts': function(util) {
        // --play-opts <opts>
        // Sets command line options passed to the `play` command.

        playOpts = util.nextArg().split(' ')
      },

      '-debug-list': function(util) {
        // --debug-list
        // Prints out the JSON representation of the active playlist.

        requiresOpenPlaylist()

        console.log(JSON.stringify(activePlaylist, null, 2))
      }
    }

    await openPlaylist('./playlist.json', true)

    await processArgv(process.argv, optionFunctions)

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

      const {
        promise: playPromise,
        controller: play
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

          play.skipCurrent()
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
      return activePlaylist
    }
  })
  .catch(err => console.error(err))

function clearConsoleLine() {
  process.stdout.write('\x1b[1K\r')
}
