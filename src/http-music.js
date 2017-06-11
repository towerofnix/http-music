#!/usr/bin/env node

'use strict'

const fs = require('fs')

const { promisify } = require('util')
const loopPlay = require('./loop-play')
const processArgv = require('./process-argv')

const downloaders = require('./downloaders')
const pickers = require('./pickers')

const {
  filterPlaylistByPathString, removeGroupByPathString, getPlaylistTreeString
} = require('./playlist-utils')

const readFile = promisify(fs.readFile)

function setupDefaultPlaylist(file) {
  return readFile(file, 'utf-8').then(
    text => JSON.parse(text),
    err => null
  )
}

setupDefaultPlaylist('./playlist.json')
  .then(async playlist => {
    let sourcePlaylist = playlist
    let activePlaylist = playlist

    let pickerType = 'shuffle'
    let downloaderType = 'http'
    let playOpts = []

    // WILL play says whether the user has forced playback via an argument.
    // SHOULD play says whether the program has automatically decided to play
    // or not, if the user hasn't set WILL play.
    let shouldPlay = true
    let willPlay = null

    function requiresOpenPlaylist() {
      if (activePlaylist === null) {
        throw new Error(
          "This action requires an open playlist - try --open (file)"
        )
      }
    }

    await processArgv(process.argv, {
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

        const playlistText = await readFile(util.nextArg(), 'utf-8')
        const openedPlaylist = JSON.parse(playlistText)
        sourcePlaylist = openedPlaylist
        activePlaylist = openedPlaylist
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

      '-downloader': function(util) {
        // --downloader <downloader type>
        // Selects the mode that songs will be downloaded with.
        // See downloaders.js.

        downloaderType = util.nextArg()
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
    })

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

      let downloader
      if (downloaderType === 'http') {
        console.log("Using HTTP downloader.")
        downloader = downloaders.makeHTTPDownloader()
      } else if (downloaderType === 'youtube') {
        console.log("Using YouTube downloader.")
        downloader = downloaders.makeYouTubeDownloader()
      } else if (downloaderType === 'local') {
        console.log("Using local file downloader.")
        downloader = downloaders.makeLocalDownloader()
      } else {
        console.error("Invalid downloader type: " + downloaderType)
        return
      }

      return loopPlay(picker, downloader, playOpts)
    } else {
      return activePlaylist
    }
  })
  .catch(err => console.error(err))
