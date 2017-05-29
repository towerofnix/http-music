// TODO: Get `avconv` working. Oftentimes `play` won't be able to play
//       some tracks due to an unsupported format; we'll need to use
//       `avconv` to convert them (to WAV).
//
// TODO: Get `play` working.
//
// TODO: Get play-next working; probably just act like a shuffle. Will
//       need to keep an eye out for the `play` process finishing.
//
// TODO: Preemptively download and process the next track, while the
//       current one is playing, to eliminate the silent time between
//       tracks.
//
// TODO: Delete old tracks! Since we aren't overwriting files, we
//       need to manually delete files once we're done with them.
//
// TODO: Clean up on SIGINT.
//
// TODO: Get library filter path from stdin.
//
// TODO: Show library tree. Do this AFTER filtering, so that people
//       can e.g. see all albums by a specific artist.
//
// TODO: Ignore .DS_Store.
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

const fsp = require('fs-promise')
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
				reject(code)
			}
		})
	})
}

function flattenPlaylist(playlist) {
	const groups = playlist.filter(x => Array.isArray(x[1]))
	const nonGroups = playlist.filter(x => x[1] && !(Array.isArray(x[1])))
	return groups.map(g => flattenPlaylist(g))
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

function pickRandomFromPlaylist(playlist) {
	const allSongs = flattenPlaylist(playlist)
	const index = Math.floor(Math.random() * allSongs.length)
	const picked = allSongs[index]
	return picked
}

function loopPlay(fn) {
	const picked = fn()
	const [ title, href ] = picked

	console.log(`Downloading ${title}..\n${href}`)

	const outWav = `.${sanitize(title)}.wav`

	return fetch(href)
		.then(res => res.buffer())
		.then(buf => fsp.writeFile('./.temp-track', buf))
		.then(() => convert('./.temp-track', outWav))
		.then(() => fsp.unlink('./.temp-track'))
		.then(() => playFile(outWav), () => console.warn('Failed to convert ' + title + '\n' + href))
		.then(() => fsp.unlink(outWav))
		.then(() => loopPlay(fn))
}

function filterPlaylistByPathString(playlist, pathString) {
	const parts = pathString.split('/')
	return filterPlaylistByPath(playlist, parts)
}

function filterPlaylistByPath(playlist, pathParts) {
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
			return groupContents
		}
	} else {
		console.warn(`Not found: "${cur}"`)
		return playlist
	}
}

function getPlaylistTreeString(playlist) {
	function recursive(group) {
		const groups = group.filter(x => Array.isArray(x[1]))
		const nonGroups = group.filter(x => x[1] && !(Array.isArray(x[1])))

		return groups.map(
			g => g[0] + recursive(g[1]).map(l => '\n| ' + l).join('')
			+ (g[1].length ? '\n|' : '')
		)
	}

	return recursive(playlist).join('\n')
}

fsp.readFile('./playlist.json', 'utf-8')
	.then(plText => JSON.parse(plText))
	.then(playlist => {
		if (process.argv.includes('-g')) {
			const groupIndex = process.argv.indexOf('-g')
			const pathString = process.argv[groupIndex + 1]
			console.log(
				'Filtering according to path: ' + pathString
			)
			return filterPlaylistByPathString(playlist, pathString)
		} else {
			return playlist
		}
	})
	.then(playlist => {
		if (process.argv.includes('-l') || process.argv.includes('--list')) {
			console.log(getPlaylistTreeString(playlist))
		} else {
			return loopPlay(() => pickRandomFromPlaylist(playlist))
		}
	})
	.catch(err => console.error(err))

/*
loopPlay(() => ['blah', 'http://192.168.2.19:1233/Koichi%20Sugiyama/Dragon%20Quest%205/34%2034%20Dragon%20Quest%205%20-%20Bonus%20Fight.mp3'])
	.catch(err => console.error(err))
*/
