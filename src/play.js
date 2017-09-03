#!/usr/bin/env node

'use strict'

const { promisify } = require('util')
const clone = require('clone')
const fs = require('fs')
const fetch = require('node-fetch')
const commandExists = require('./command-exists')
const startLoopPlay = require('./loop-play')
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
    if (await commandExists('mkfifo')) {
      return 'mpv'
    } else {
      return 'mpv-nofifo'
    }
  } else if (await commandExists('play')) {
    return 'play'
  } else {
    return null
  }
}

async function main(args) {
  let sourcePlaylist = null
  let activePlaylist = null

  let pickerSortMode = 'shuffle'
  let pickerLoopMode = 'loop-regenerate'
  let playerCommand = await determineDefaultPlayer()

  // WILL play says whether the user has forced playback via an argument.
  // SHOULD play says whether the program has automatically decided to play
  // or not, if the user hasn't set WILL play.
  let shouldPlay = true
  let willPlay = null

  let disablePlaybackStatus = false

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

    '-sort-mode': function(util) {
      // --sort-mode <mode>  (alias: --sort)
      // Sets the mode by which the playback order list is sorted.
      // See pickers.js.

      pickerSortMode = util.nextArg()
    },

    '-sort': util => util.alias('-sort-mode'),

    '-loop-mode': function(util) {
      // --loop-mode <mode>  (alias: --loop)
      // Sets the mode by which the playback order list is looped (typically,
      // what happens when the picker's index counter gets to the end of the
      // list).
      // See pickers.js.

      pickerLoopMode = util.nextArg()
    },

    '-loop': util => util.alias('-loop-mode'),

    '-player': function(util) {
      // --player <player>
      // Sets the shell command by which audio is played.
      // Valid options include 'sox' (or 'play') and 'mpv'. Use whichever is
      // installed on your system.

      playerCommand = util.nextArg()
    },

    '-disable-playback-status': function() {
      // --disable-playback-status  (alias: --hide-playback-status)
      // Hides the playback status line.

      console.log("Not showing playback status.")
      disablePlaybackStatus = true
    },

    '-hide-playback-status': util => util.alias('-disable-playback-status')
  }

  await openPlaylist('./playlist.json', true)

  await processArgv(args, optionFunctions)

  if (activePlaylist === null) {
    throw new Error(
      "Cannot play - no open playlist. Try --open <playlist file>?"
    )
  }

  if (willPlay || (willPlay === null && shouldPlay)) {
    console.log(`Using sort: ${pickerSortMode} and loop: ${pickerLoopMode}.`)

    console.log(`Using ${playerCommand} player.`)

    const {
      promise: playPromise,
      playController,
      downloadController,
      player
    } = await startLoopPlay(activePlaylist, {
      pickerOptions: {
        loop: pickerLoopMode,
        sort: pickerSortMode
      },
      playerCommand,
      disablePlaybackStatus
    })

    // We're looking to gather standard input one keystroke at a time.
    // But that isn't *always* possible, e.g. when piping into the http-music
    // command through the shell.
    if ('setRawMode' in process.stdin) {
      process.stdin.setRawMode(true)
    } else {
      console.warn("User input cannot be gotten!")
      console.warn("If you're piping into http-music, this is normal.")
    }

    const commands = {
      'doNothing': function() {},

      // TODO: Separate pause and unpause commands
      'toggle_pause': function() {
        player.togglePause()
      },

      'quit': function() {
        playController.stop().then(() => {
          process.exit(0)
        })
      },

      'seek': function(seconds) {
        // TODO: Does it even make sense to have these two methods be
        // separate?
        if (seconds < 0) {
          player.seekBack(-seconds)
        } else {
          player.seekAhead(seconds)
        }
      },

      'changeVolume': function(diff) {
        // TODO: Why have these be separate?
        if (diff < 0) {
          player.volDown(-diff)
        } else {
          player.volUp(diff)
        }
      },

      // TODO: Skip back/ahead multiple tracks at once

      'skipBack': function() {
        clearConsoleLine()
        console.log("Skipping backwards. (Press I for track info!")

        playController.skipBack()
      },

      'skipAhead': function() {
        clearConsoleLine()
        console.log(
          "Skipping the track that's currently playing. " +
          "(Press I for track info!)"
        )

        playController.skip()
      },

      'skip': function() {
        commands.skipAhead()
      },

      'skipUpNext': function() {
        clearConsoleLine()
        console.log("Skipping the track that's up next.")

        playController.skipUpNext().then(nextTrack => {
          console.log(
            `New track up next: ${nextTrack.name || '(Unnamed)'}` +
            " (Press I for track info!)"
          )
        })
      },

      // TODO: Number of history/up-next tracks to show.
      'showTrackInfo': function() {
        clearConsoleLine()
        playController.logTrackInfo()
      }
    }

    const splitChars = str => str.split('').map(char => char.charCodeAt(0))

    const simpleKeybindings = {
      space: [0x20],
      esc: [0x1b], escape: [0x1b],
      up: [0x1b, ...splitChars('[A')],
      down: [0x1b, ...splitChars('[B')],
      right: [0x1b, ...splitChars('[C')],
      left: [0x1b, ...splitChars('[D')],
      shiftUp: [0x1b, ...splitChars('[1;2A')],
      shiftDown: [0x1b, ...splitChars('[1;2B')],
      shiftRight: [0x1b, ...splitChars('[1;2C')],
      shiftLeft: [0x1b, ...splitChars('[1;2D')],
      delete: [0x7f]
    }

    // TODO: Load these from a file
    // TODO: Verify that each command exists
    const commandBindings = {
      bindings: [
        [['space'], 'togglePause'],
        [['left'], 'seek', -5],
        [['right'], 'seek', +5],
        [['shiftLeft'], 'seek', -30],
        [['shiftRight'], 'seek', +30],
        [['up'], 'skipBack'],
        [['down'], 'skipAhead'],
        [['s'], 'skipAhead'],
        [['delete'], 'skipUpNext'],
        [['i'], 'showTrackInfo'],
        [['t'], 'showTrackInfo'],
        [['q'], 'quit']
      ]
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

      if (
        Buffer.from([0x03]).equals(data) || // ^C
        Buffer.from([0x04]).equals(data) // ^D
      ) {
        playController.stop().then(() => {
          process.exit(0)
        })

        return
      }

      for (let [ keyBinding, command, ...args ] of commandBindings.bindings) {
        let run = true

        // TODO: "Compile" keybindings upon loading them
        const buffer = Buffer.from(keyBinding.map(item => {
          if (typeof item === 'number') {
            return [item]
          } else if (Object.keys(simpleKeybindings).includes(item)) {
            return simpleKeybindings[item]
          } else if (typeof item === 'string' && item.length === 1) {
            return [item.charCodeAt(0)]
          } else {
            // Error
            console.warn('Invalid keybinding part?', item, 'in', keyBinding)
            return [0xFF]
          }
        }).reduce((a, b) => a.concat(b), []))

        run = buffer.equals(data)

        if (run && Object.keys(commands).includes(command)) {
          commands[command](...args)
        }
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
