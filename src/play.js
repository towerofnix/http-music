#!/usr/bin/env node

'use strict'

const { promisify } = require('util')
const { spawn } = require('child_process')
const fs = require('fs')
const fetch = require('node-fetch')
const commandExists = require('./command-exists')
const startLoopPlay = require('./loop-play')
const processArgv = require('./process-argv')
const promisifyProcess = require('./promisify-process')
const { processSmartPlaylist } = require('./smart-playlist')
const { filterPlaylistByPathString, isTrack, flattenGrouplike } = require('./playlist-utils')
const { compileKeybindings, getComboForCommand, stringifyCombo } = require('./keybinder')
const { makePlaylistOptions } = require('./general-util')

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

  // The file to write the playlist path of the current file to.
  let trackDisplayFile

  // The (custom) status line template strings.
  let statusLineTemplates = [
    '%longIndex% (%percentDone%) %timeDone% / %timeLeft%',
    '%longIndex% (%percentDone%) %timeDone% / %duration%'
  ]
  let titleLineTemplate

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
    [['<'], 'previousStatusLine'],
    [['>'], 'nextStatusLine'],
    [['q'], 'quit'], [['Q'], 'quit']
  ]

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

  const {
    optionFunctions, getStuff,
    openDefaultPlaylist
  } = await makePlaylistOptions()

  const {
    '-write-playlist': originalWritePlaylist,
    '-print-playlist': originalPrintPlaylist,
    '-list-groups': originalListGroups,
    '-list-all': originalListAll
  } = optionFunctions

  Object.assign(optionFunctions, {

    // Extra play-specific behavior -------------------------------------------

    '-write-playlist': async function(util) {
      await originalWritePlaylist(util)

      // If this is the last option, the user probably doesn't actually
      // want to play the playlist. (We need to check if this is len - 2
      // rather than len - 1, because of the <file> option that comes
      // after --write-playlist.)
      if (util.index === util.argv.length - 2) {
        shouldPlay = false
      }
    },

    '-print-playlist': async function(util) {
      await originalPrintPlaylist(util)

      // As with --write-playlist, the user probably doesn't want to actually
      // play anything if this is the last option.
      if (util.index === util.argv.length - 1) {
        shouldPlay = false
      }
    },

    '-list-groups': async function(util) {
      await originalListGroups(util)

      // If this is the last item in the argument list, the user probably
      // only wants to get the list, so we'll mark the 'should run' flag
      // as false.
      if (util.index === util.argv.length - 1) {
        shouldPlay = false
      }
    },


    '-list-all': async function(util) {
      await originalListAll(util)

      // As with -l, if this is the last item in the argument list, we
      // won't actually be playing the playlist.
      if (util.index === util.argv.length - 1) {
        shouldPlay = false
      }
    },

    // Other options, specific to play ----------------------------------------

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

    // Add appends the keybindings to the existing keybindings; import replaces
    // the current ones with the opened ones.

    '-add-keybindings': async function(util) {
      await openKeybindings(util.nextArg())
    },

    '-open-keybindings': util => util.alias('-add-keybindings'),

    '-import-keybindings': async function(util) {
      await openKeybindings(util.nextArg(), false)
    },

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

      const track = filterPlaylistByPathString(
        getStuff.activePlaylist, pathString
      )

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

    '-status-line': function(util) {
      // --status-line <string>  (alias: --playback-status-line, --status, etc)
      // Sets the text to be shown in status line. This is a "template" string,
      // which means you can use text such as %timeLeft% and %duration% and
      // these will be replaced with appropriate values.)

      statusLineTemplates = [util.nextArg()]
      console.log('Using custom status line:', statusLineTemplates[0])
    },

    '-playback-status': util => util.alias('-status-line'),
    '-playback-status-line': util => util.alias('-status-line'),
    '-playback-line': util => util.alias('-status-line'),
    '-status': util => util.alias('-status-line'),

    '-add-status-line': function(util) {
      // --add-status-line <string> (alias: all the same ones as --status-line)
      // Works basically the same as --status-line, but adds a status line that
      // can be switched to using the "<" and ">" keys. The most-recently-added
      // status line is the one that's selected by default.

      const line = util.nextArg()
      if (statusLineTemplates) {
        statusLineTemplates.push(line)
      } else {
        statusLineTemplates = [line]
      }
      console.log('Adding a quick-switch status line:', line)
    },

    '-title-status-line': function(util) {
      // --title-status-line <string> (alias: --title)
      // Sets the text to be displayed in the title of the terminal window.
      // This has particularly noticable use alongside utilities such as tmux
      // and screen; for example, in tmux, the window list at the bottom of
      // the screen will show the string here.  As with --status-line, this is
      // a "template" string, of course. Setting this to an empty string
      // disables the title status line (which is the default).

      titleLineTemplate = util.nextArg()
      console.log('Using custom title line:', titleLineTemplate)
    },

    '-title-line': util => util.alias('-title-status-line'),
    '-title': util => util.alias('-title-status-line'),

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
  })

  await processArgv(args, optionFunctions)

  if (!getStuff.hasOpenedPlaylist) {
    await openDefaultPlaylist()
  }

  // All done processing: let's actually grab the active playlist, which
  // we'll quickly validate and then play (if it contains tracks).
  const activePlaylist = getStuff.activePlaylist

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
      statusLineTemplates,
      titleLineTemplate,
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

      'nextStatusLine': function() {
        playController.nextStatusLine()
      },

      'previousStatusLine': function() {
        playController.previousStatusLine()
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
