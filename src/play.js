#!/usr/bin/env node

'use strict'

const { promisify } = require('util')
const { spawn } = require('child_process')
const clone = require('clone')
const fs = require('fs')
const fetch = require('node-fetch')
const commandExists = require('./command-exists')
const startLoopPlay = require('./loop-play')
const processArgv = require('./process-argv')
const promisifyProcess = require('./promisify-process')
const { processSmartPlaylist } = require('./smart-playlist')

const {
  filterPlaylistByPathString, removeGroupByPathString, getPlaylistTreeString,
  updatePlaylistFormat, collapseGrouplike, filterGrouplikeByProperty, isTrack,
  flattenGrouplike
} = require('./playlist-utils')

const {
  downloadPlaylistFromOptionValue
} = require('./general-util')

const {
  compileKeybindings, getComboForCommand, stringifyCombo
} = require('./keybinder')

const readFile = promisify(fs.readFile)
const writeFile = promisify(fs.writeFile)

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

async function determineDefaultConverter() {
  if (await commandExists('ffmpeg')) {
    return 'ffmpeg'
  } else if (await commandExists('avconv')) {
    return 'avconv'
  } else {
    return null
  }
}

async function main(args) {
  let sourcePlaylist = null
  let activePlaylist = null

  let pickerSortMode = 'shuffle'
  let pickerLoopMode = 'loop-regenerate'
  let shuffleSeed
  let startTrack
  let playerCommand = await determineDefaultPlayer()
  let converterCommand = await determineDefaultConverter()

  // WILL play says whether the user has forced playback via an argument.
  // SHOULD play says whether the program has automatically decided to play
  // or not, if the user hasn't set WILL play.
  let shouldPlay = true
  let willPlay = null

  // The same WILL/SHOULD rules apply here.
  let shouldUseConverterOptions = true
  let willUseConverterOptions = null

  let disablePlaybackStatus = false

  // Trust shell commands - permits keybindings to activate console commands.
  let trustShellCommands = false

  // Whether or not "trust shell commands" *may* be set to true. Set to false
  // when shell command permissions are revoked (to prevent them from being
  // granted in the future). Basic protection against dumb attempts at Evil
  // keybinding files.
  let mayTrustShellCommands = true

  // The file to output the playlist path to the current file.
  let trackDisplayFile

  // Whether or not a playlist has been opened yet. This is just used to
  // decide when exactly to load the default playlist. (We don't want to load
  // it as soon as the process starts, since there might be an --open-playlist
  // option that specifies opening a *different* playlist! But if we encounter
  // an action that requires a playlist, and no playlist has yet been opened,
  // we assume that the user probably wants to do something with the default
  // playlist, and that's when we open it. See requiresOpenPlaylist for the
  // implementation of this.)
  let hasOpenedPlaylist = false

  const keybindings = [
    [['space'], 'togglePause'],
    [['left'], 'seek', -5],
    [['right'], 'seek', +5],
    [['shiftLeft'], 'seek', -30],
    [['shiftRight'], 'seek', +30],
    [['up'], 'skipBack'],
    [['down'], 'skipAhead'],
    [['delete'], 'skipUpNext'],
    [['s'], 'skipAhead'], [['S'], 'skipAhead'],
    [['i'], 'showTrackInfo'], [['I'], 'showTrackInfo'],
    [['t'], 'showTrackInfo', 0, 0], [['T'], 'showTrackInfo', 0, 0],
    [['%'], 'showTrackInfo', 20, 0],
    [['q'], 'quit'], [['Q'], 'quit']
  ]

  async function openPlaylist(arg, silent = false) {
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

  async function loadPlaylist(importedPlaylist) {
    // Takes an actual playlist object and sets it up as the source and active
    // playlist.

    const openedPlaylist = updatePlaylistFormat(importedPlaylist)

    // We also want to de-smart-ify (stupidify? - simplify?) the playlist.
    const processedPlaylist = await processSmartPlaylist(openedPlaylist)

    // ..And finally, we have to update the playlist format again, since
    // processSmartPlaylist might have added new (un-updated) items:
    const finalPlaylist = updatePlaylistFormat(processedPlaylist, true)
    // We also pass true so that the playlist-format-updater knows that this
    // is the source playlist.

    sourcePlaylist = finalPlaylist

    // The active playlist is a clone of the source playlist; after all it's
    // quite possible we'll be messing with the value of the active playlist,
    // and we don't want to reflect those changes in the source playlist.
    activePlaylist = clone(sourcePlaylist)

    await processArgv(processedPlaylist.options, optionFunctions)
  }

  async function openKeybindings(arg, add = true) {
    console.log("Opening keybindings from: " + arg)

    let keybindingText

    // TODO: Maybe let keybindings be downloaded from a file? We'd probably
    // just have to rename the downloadPlaylistFromOptionValue function's
    // name.
    try {
      keybindingText = await readFile(arg)
    } catch(err) {
      console.error("Failed to open keybinding file: " + arg)
      return false
    }

    const openedKeybindings = JSON.parse(keybindingText)

    if (!add) {
      keybindings.splice(0)
    }

    // Place new keybindings at the top of the array, so that they are
    // prioritized over old ones.
    keybindings.unshift(...openedKeybindings)
  }

  async function requiresOpenPlaylist() {
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

  function openDefaultPlaylist() {
    return openPlaylist('./playlist.json', true)
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

    '-print-playlist': async function(util) {
      // --print-playlist  (alias: --log-playlist, --json)
      // Prints out the JSON representation of the active playlist.

      await requiresOpenPlaylist()

      console.log(JSON.stringify(activePlaylist, null, 2))

      // As with --write-playlist, the user probably doesn't want to actually
      // play anything if this is the last option.
      if (util.index === util.argv.length - 1) {
        shouldPlay = false
      }
    },

    '-log-playlist': util => util.alias('-print-playlist'),
    '-json': util => util.alias('-print-playlist'),

    // Add appends the keybindings to the existing keybindings; import replaces
    // the current ones with the opened ones.

    '-add-keybindings': async function(util) {
      await openKeybindings(util.nextArg())
    },

    '-open-keybindings': util => util.alias('-add-keybindings'),

    '-import-keybindings': async function(util) {
      await openKeybindings(util.nextArg(), false)
    },

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

      // If this is the last item in the argument list, the user probably
      // only wants to get the list, so we'll mark the 'should run' flag
      // as false.
      if (util.index === util.argv.length - 1) {
        shouldPlay = false
      }
    },

    '-list': util => util.alias('-list-groups'),
    'l': util => util.alias('-list-groups'),

    '-list-all': async function(util) {
      // --list-all  (alias: --list-tracks, -L)
      // Lists all groups and tracks in the playlist.

      await requiresOpenPlaylist()

      console.log(getPlaylistTreeString(activePlaylist, true))

      // As with -l, if this is the last item in the argument list, we
      // won't actually be playing the playlist.
      if (util.index === util.argv.length - 1) {
        shouldPlay = false
      }
    },

    '-list-tracks': util => util.alias('-list-all'),
    'L': util => util.alias('-list-all'),

    '-list-keybindings': function() {
      console.log('Keybindings:')

      for (const [ combo, command, ...args ] of keybindings) {
        console.log(`${stringifyCombo(combo)}: ${command}${
          args ? ' ' + args.join(' ') : ''}`)
      }

      shouldPlay = false
    },

    '-show-keybindings': util => util.alias('-list-keybindings'),
    '-keybindings': util => util.alias('-list-keybindings'),

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
    'S': util => util.alias('-sort-mode'),

    '-shuffle-seed': function(util) {
      // --shuffle-seed <seed>  (alias: --seed)
      // Sets the seed used for random number generation (so, in shuffles).
      // Primarily used for debugging, but can be used to save an interesting
      // shuffle. (Try adding {"options": ["--seed", "..."]} to your
      // playlist!)

      shuffleSeed = util.nextArg()
    },

    '-seed': util => util.alias('-shuffle-seed'),

    '-loop-mode': function(util) {
      // --loop-mode <mode>  (alias: --loop)
      // Sets the mode by which the playback order list is looped (typically,
      // what happens when the picker's index counter gets to the end of the
      // list).
      // See pickers.js.

      pickerLoopMode = util.nextArg()
    },

    '-loop': util => util.alias('-loop-mode'),

    '-start': function(util) {
      // --start <track path>  (alias: -s, --start-track, --start-[on|at])
      // Sets the first track to be played.
      // This is especially useful when using an ordered sort; this option
      // could be used to start a long album part way through.
      const pathString = util.nextArg()
      const track = filterPlaylistByPathString(activePlaylist, pathString)
      if (isTrack(track)) {
        startTrack = track
        console.log('Starting on track', pathString)
      } else {
        console.warn(
          'A starting track path was given, but there is no track at ' +
          'that path?'
        )
      }
    },

    '-start-track': util => util.alias('-start'),
    '-start-on': util => util.alias('-start'),
    '-start-at': util => util.alias('-start'),
    '-starting-track': util => util.alias('-start'),
    '-starting-on': util => util.alias('-start'),
    '-starting-at': util => util.alias('-start'),
    's': util => util.alias('-start'),

    '-player': function(util) {
      // --player <player>
      // Sets the shell command by which audio is played.
      // Valid options include 'sox' (or 'play') and 'mpv'. Use whichever is
      // installed on your system.

      playerCommand = util.nextArg()
    },

    '-converter': async function(util) {
      const command = util.nextArg()

      if (await commandExists(command)) {
        converterCommand = command
      } else {
        console.warn(`Converter ${command} does not exist!`)
        console.warn(
          'Because of this, track-specific converter options are being' +
          ' disabled. (Use --enable-converter-options to force usage of' +
          ' them.)'
        )

        shouldUseConverterOptions = false
      }
    },

    '-baz': function() {
      // --baz
      // Debugger argument used to print a message as soon as this it is
      // processed. Handy for making sure the arguments are being processed
      // in the right order.

      console.log('Baz!')
    },

    '-foo': function(util) {
      // --foo
      // Similar to --baz, but logs the next argument rather than 'Baz!'.

      console.log(util.nextArg())
    },

    '-enable-converter-options': function() {
      // --enable-converter-options  (alias: --use-converter-options)
      // Forces usage of track-specific converter options.

      willUseConverterOptions = true
    },

    '-use-converter-options': util => util.alias('-enable-converter-options'),

    '-disable-converter-options': function() {
      // --disable-converter-options  (alias: --no-use-converter-options)
      // Forces track-specific converter options to not be used.

      willUseConverterOptions = false
    },

    '-no-use-converter-options': util => {
      return util.alias('-disable-converter-options')
    },

    '-disable-playback-status': function() {
      // --disable-playback-status  (alias: --hide-playback-status)
      // Hides the playback status line.

      console.log("Not showing playback status.")
      disablePlaybackStatus = true
    },

    '-hide-playback-status': util => util.alias('-disable-playback-status'),

    '-track-display-file': async function(util) {
      // --track-display-file  (alias: --display-track-file)
      // Sets the file to output the current track's path to every time a new
      // track is played. This is mostly useful for using tools like OBS to
      // interface with http-music, for example so that you can display the
      // name/path of the track that is currently playing in a live stream.
      const file = util.nextArg()
      try {
        await writeFile(file, 'Not yet playing.')
      } catch (error) {
        console.log(`Failed to set track display file to "${file}".`)
        return
      }
      trackDisplayFile = file
    },

    '-display-track-file': util => util.alias('-track-display-file'),

    '-trust-shell-commands': function(util) {
      // --trust-shell-commands  (alias: --trust)
      // Lets keybindings run shell commands. Only use this when loading
      // keybindings from a trusted source. Defaults to false (no shell
      // permissions).

      // We don't want an imported playlist to enable this! - Only arguments
      // directly passed to http-music from the command line.
      if (util.argv !== args) {
        console.warn(
          "--trust-shell-commands must be passed directly to http-music " +
          "from the command line! (Revoking shell command permissions.)"
        )

        trustShellCommands = false
        mayTrustShellCommands = false
      } else {
        console.log("Trusting shell commands.")
        trustShellCommands = true
      }
    },

    '-trust': util => util.alias('-trust-shell-commands')
  }

  await processArgv(args, optionFunctions)

  if (!hasOpenedPlaylist) {
    await openDefaultPlaylist()
  }

  if (activePlaylist === null) {
    console.error(
      "Cannot play - no open playlist. Try --open <playlist file>?"
    )
    console.error(
      "You could also try \x1b[1mhttp-music setup\x1b[0m to easily " +
      "create a playlist file!"
    )
    return false
  }

  if (willPlay || (willPlay === null && shouldPlay)) {
    // Quick and simple test - if there are no items in the playlist, don't
    // continue. This is mainly to catch incomplete user-entered commands
    // (like `http-music play -c`).
    if (flattenGrouplike(activePlaylist).items.length === 0) {
      console.error(
        'Your playlist doesn\'t have any tracks in it, so it can\'t be ' +
        'played.'
      )
      console.error(
        '(Make sure your http-music command doesn\'t have any typos ' +
        'and isn\'t incomplete? You might have used -c or --clear but not ' +
        '--keep to actually pick tracks to play!)'
      )
      return false
    }

    console.log(`Using sort: ${pickerSortMode} and loop: ${pickerLoopMode}.`)
    console.log(`Using ${playerCommand} player.`)
    console.log(`Using ${converterCommand} converter.`)

    const {
      promise: playPromise,
      playController,
      downloadController,
      player
    } = await startLoopPlay(activePlaylist, {
      pickerOptions: {
        loop: pickerLoopMode,
        sort: pickerSortMode,
        seed: shuffleSeed
      },
      playerCommand, converterCommand,
      useConverterOptions: willUseConverterOptions || (
        willUseConverterOptions === null && shouldUseConverterOptions
      ),
      disablePlaybackStatus,
      startTrack,
      trackDisplayFile
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

    const trackInfoCombo = stringifyCombo(getComboForCommand(
      'showTrackInfo', keybindings
    ))

    const trackInfoString = `(Press ${trackInfoCombo} for track info!)`

    const commands = {
      'doNothing': function() {},

      // TODO: Separate pause and unpause commands
      'togglePause': function() {
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
        console.log("Skipping backwards.", trackInfoString)

        playController.skipBack()
      },

      'skipAhead': function() {
        clearConsoleLine()
        console.log(
          "Skipping the track that's currently playing.", trackInfoString
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

      'showTrackInfo': function(previousTrackCount = 3, upNextTrackCount = undefined) {
        clearConsoleLine()
        playController.logTrackInfo(previousTrackCount, upNextTrackCount)
      },

      'runShellCommand': async function(command, args) {
        if (trustShellCommands) {
          console.log(
            'From keybinding, running shell command:',
            `${command} ${args.join(' ')}`
          )
          await promisifyProcess(spawn(command, args))
        } else {
          console.warn(
            'From keybinding, shell command requested but not executed',
            '(no --trust):',
            `${command} ${args.join(' ')}`
          )
        }
      }
    }

    const keybindingHandler = compileKeybindings(keybindings, commands)

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

      keybindingHandler(data)
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
