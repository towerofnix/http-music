// TODO: Get `avconv` working. Oftentimes `play` won't be able to play
//       some tracks due to an unsupported format; we'll need to use
//       `avconv` to convert them (to WAV).
//       (Done!)
//
// TODO: Get `play` working.
//       (Done!)
//
// TODO: Get play-next working; probably just act like a shuffle. Will
//       need to keep an eye out for the `play` process finishing.
//       (Done!)
//
// TODO: Preemptively download and process the next track, while the
//       current one is playing, to eliminate the silent time between
//       tracks.
//       (Done!)
//
// TODO: Delete old tracks! Since we aren't overwriting files, we
//       need to manually delete files once we're done with them.
//       (Done!)
//
// TODO: Clean up on SIGINT.
//
// TODO: Get library filter path from stdin.
//       (Done!)
//
// TODO: Show library tree. Do this AFTER filtering, so that people
//       can e.g. see all albums by a specific artist.
//       (Done!)
//
// TODO: Ignore .DS_Store.
//       (Done!)
//
// TODO: Have a download timeout, somehow.
//
// TODO: Fix the actual group format. Often times we get single-letter
//       files being downloaded (which don't exist); I'm guessing that's
//       related to folder names (which are just strings, not title-href
//       arrays) still being in the group array. (Update: that's defin-
//       itely true; 'Saucey Sounds'[0] === 'S', and 'Unofficial'[0]
//       === 'U', which are the two "files" it crashes on while playing
//       -g 'Jake Chudnow'.)
//       (Done!)
//
// TODO: A way to exclude a specific group path.
//       (Done!)
//
// TODO: Better argv handling.
//       (Done!)
//
// TODO: Option to include a specific path from the source playlist.
//       (Done!)
//
// TODO: Make a playlist generator that parses http://billwurtz.com
//       instrumentals.html.
//       (Done!)
//
// TODO: Make crawl-itunes.js a bit more general, more command-line
//       friendly (i.e. don't require editing the script itself), and
//       make it use the getHTMLLinks function defined in the new
//       crawl-links.js script.
//       (Done!)
//
// TODO: Play-in-order track picker.
//       (Done!)

'use strict'

const fs = require('mz/fs')
const fetch = require('node-fetch')
const sanitize = require('sanitize-filename')
const { spawn } = require('child_process')

function promisifyProcess(proc, showLogging = true) {
	return new Promise((resolve, reject) => {
		if (showLogging) {
			proc.stdout.pipe(process.stdout)
			proc.stderr.pipe(process.stderr)
		}

		proc.on('exit', code => {
			if (code === 0) {
				resolve()
			} else {
				console.error('Process failed!', proc.spawnargs)
				reject(code)
			}
		})
	})
}

function flattenPlaylist(playlist) {
	const groups = playlist.filter(x => Array.isArray(x[1]))
	const nonGroups = playlist.filter(x => x[1] && !(Array.isArray(x[1])))
	return groups.map(g => flattenPlaylist(g[1]))
		.reduce((a, b) => a.concat(b), nonGroups)
}

function convert(fromFile, toFile) {
	const avconv = spawn('avconv', ['-y', '-i', fromFile, toFile])
	return promisifyProcess(avconv, false)
}

function playFile(file) {
	const play = spawn('play', [file])
	return promisifyProcess(play)
}

function makeOrderedPlaylistPicker(playlist) {
	const allSongs = flattenPlaylist(playlist)
	let index = 0

	return function() {
		if (index < allSongs.length) {
			const picked = allSongs[index]
			index++
			return picked
		} else {
			return null
		}
	}
}

function makeShufflePlaylistPicker(playlist) {
	const allSongs = flattenPlaylist(playlist)

	return function() {
		const index = Math.floor(Math.random() * allSongs.length)
		const picked = allSongs[index]
		return picked
	}
}

async function loopPlay(fn) {
	// Looping play function. Takes one argument, the "pick" function,
	// which returns a track to play. Preemptively downloads the next
	// track while the current one is playing for seamless continuation
	// from one song to the next. Stops when the result of the pick
	// function is null (or similar).

	async function downloadNext() {
		const picked = fn()

		if (picked == null) {
			return false
		}

		const [ title, href ] = picked
		console.log(`Downloading ${title}..\n${href}`)

		const wavFile = `.${sanitize(title)}.wav`

		const res = await fetch(href)
		const buffer = await res.buffer()
		await fs.writeFile('./.temp-track', buffer)

		try {
			await convert('./.temp-track', wavFile)
		} catch(err) {
			console.warn('Failed to convert ' + title)
			console.warn('Selecting a new track\n')

			return await downloadNext()
		}

		await fs.unlink('./.temp-track')

		return wavFile
	}

	let wavFile = await downloadNext()

	while (wavFile) {
		const nextPromise = downloadNext()
		await playFile(wavFile)
		await fs.unlink(wavFile)
		wavFile = await nextPromise
	}
}

function filterPlaylistByPathString(playlist, pathString) {
	return filterPlaylistByPath(playlist, parsePathString(pathString))
}

function filterPlaylistByPath(playlist, pathParts) {
	// Note this can be used as a utility function, rather than just as
	// a function for use by the argv-handler!

	let cur = pathParts[0]

	if (!(cur.endsWith('/'))) {
		cur = cur + '/'
	}

	const match = playlist.find(g => g[0] === cur && Array.isArray(g[1]))

	if (match) {
		const groupContents = match[1]
		if (pathParts.length > 1) {
			const rest = pathParts.slice(1)
			return filterPlaylistByPath(groupContents, rest)
		} else {
			return match
		}
	} else {
		console.warn(`Not found: "${cur}"`)
		return playlist
	}
}

function ignoreGroupByPathString(playlist, pathString) {
	const pathParts = parsePathString(pathString)
	return ignoreGroupByPath(playlist, pathParts)
}

function ignoreGroupByPath(playlist, pathParts) {
	// TODO: Ideally this wouldn't mutate the given playlist.

	const groupToRemove = filterPlaylistByPath(playlist, pathParts)

	const parentPath = pathParts.slice(0, pathParts.length - 1)
	let parent

	if (parentPath.length === 0) {
		parent = playlist
	} else {
		parent = filterPlaylistByPath(playlist, pathParts.slice(0, -1))
	}

	const index = parent.indexOf(groupToRemove)

	if (index >= 0) {
		parent.splice(index, 1)
	} else {
		console.error(
			'Group ' + pathParts.join('/') + ' doesn\'t exist, so we can\'t ' +
			'explicitly ignore it.'
		)
	}
}

function getPlaylistTreeString(playlist, showTracks = false) {
	function recursive(group) {
		const groups = group.filter(x => Array.isArray(x[1]))
		const nonGroups = group.filter(x => x[1] && !(Array.isArray(x[1])))

		const childrenString = groups.map(g => {
			const groupString = recursive(g[1])

			if (groupString) {
				const indented = groupString.split('\n').map(l => '| ' + l).join('\n')
				return '\n' + g[0] + '\n' + indented
			} else {
				return g[0]
			}
		}).join('\n')

		const tracksString = (showTracks ? nonGroups.map(g => g[0]).join('\n') : '')

		if (tracksString && childrenString) {
			return tracksString + '\n' + childrenString
		} else if (childrenString) {
			return childrenString
		} else if (tracksString) {
			return tracksString
		} else {
			return ''
		}
	}

	return recursive(playlist)
}

function parsePathString(pathString) {
	const pathParts = pathString.split('/')
	return pathParts
}

async function processArgv(argv, handlers) {
	for (let i = 0; i < argv.length; i++) {
		const cur = argv[i]
		if (cur.startsWith('-')) {
			const opt = cur.slice(1)
			if (opt in handlers) {
				await handlers[opt]({
					argv, index: i,
					nextArg: function() {
						i++
						return argv[i]
					}
				})
			} else {
				console.warn('Option not understood: ' + cur)
			}
		}
	}
}

fs.readFile('./playlist.json', 'utf-8')
	.then(plText => JSON.parse(plText))
	.then(async playlist => {
		let sourcePlaylist = playlist
		let curPlaylist = playlist

		let pickerType = 'shuffle'

		// WILL play says whether the user has forced playback via an argument.
		// SHOULD play says whether the program has automatically decided to play
		// or not, if the user hasn't set WILL play.
		let shouldPlay = true
		let willPlay = null

		await processArgv(process.argv, {
			'o': async function(util) {
				// -o <file>
				// Opens a separate playlist file.
				// This sets the source playlist.

				const openedPlaylist = JSON.parse(await fs.readFile(util.nextArg(), 'utf-8'))
				sourcePlaylist = openedPlaylist
				curPlaylist = openedPlaylist
			},

			'c': function(util) {
				// -c
				// Clears the active playlist. This does not affect the source
				// playlist.

				curPlaylist = []
			},

			'k': function(util) {
				// -k <groupPath>
				// Keeps a group by loading it from the source playlist into the
				// active playlist. This is usually useful after clearing the
				// active playlist; it can also be used to keep a subgroup when
				// you've ignored an entire parent group, e.g. `-i foo -k foo/baz`.

				const pathString = util.nextArg()
				const group = filterPlaylistByPathString(sourcePlaylist, pathString)
				curPlaylist.push(group)
			},

			'g': function(util) {
				// -g <groupPath>
				// Filters the playlist so that only the tracks under the passed
				// group path will play.

				const pathString = util.nextArg()
				console.log('Filtering according to path: ' + pathString)
				curPlaylist = filterPlaylistByPathString(curPlaylist, pathString)[1]
			},

			'i': function(util) {
				// -i <groupPath>
				// Filters the playlist so that the given path is removed.

				const pathString = util.nextArg()
				console.log('Ignoring path: ' + pathString)
				ignoreGroupByPathString(curPlaylist, pathString)
			},

			'l': function(util) {
				// -l
				// Lists all groups in the playlist.
				// Try -L (upper-case L) for a list including tracks.

				console.log(getPlaylistTreeString(curPlaylist))

				// If this is the last item in the argument list, the user probably
				// only wants to get the list, so we'll mark the 'should run' flag
				// as false.
				if (util.index === util.argv.length - 1) {
					shouldPlay = false
				}
			},

			'L': function(util) {
				// -L
				// Lists all groups AND tracks in the playlist.
				// Try -l (lower-case L) for a list that doesn't include tracks.

				console.log(getPlaylistTreeString(curPlaylist, true))

				// As with -l, if this is the last item in the argument list, we
				// won't actually be playing the playlist.
				if (util.index === util.argv.length - 1) {
					shouldPlay = false
				}
			},

			'p': function(util) {
				// -p
				// Forces the playlist to actually play.

				willPlay = true
			},

			'np': function(util) {
				// -np
				// Forces the playlist not to play.

				willPlay = false
			},

			'-debug-list': function(util) {
				// --debug-list
				// Prints out the JSON representation of the active playlist.

				console.log(JSON.stringify(curPlaylist, null, 2))
			},

			'-picker': function(util) {
				// --picker <shuffle|ordered>
				// Selects the mode that the song to play is picked.
				// This should be used after finishing modifying the active
				// playlist.

				pickerType = util.nextArg()
			}
		})

		if (willPlay || (willPlay === null && shouldPlay)) {
			let picker
			if (pickerType === 'shuffle') {
				console.log('Using shuffle picker')
				picker = makeShufflePlaylistPicker(curPlaylist)
			} else if (pickerType === 'ordered') {
				console.log('Using ordered picker')
				picker = makeOrderedPlaylistPicker(curPlaylist)
			} else {
				console.error('Invalid picker type: ' + pickerType)
			}

			return loopPlay(picker)
		} else {
			return curPlaylist
		}
	})
	.catch(err => console.error(err))
