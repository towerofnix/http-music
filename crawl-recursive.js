'use strict'

const MAX_DOWNLOAD_ATTEMPTS = 5

const fetch = require('node-fetch')
const { getHTMLLinks } = require('./crawl-links')

function crawl(absURL, attempts = 0) {
	return fetch(absURL)
		.then(res => res.text().then(text => playlistifyParse(text, absURL)), err => {
			console.error('Failed to download: ' + absURL)

			if (attempts < MAX_DOWNLOAD_ATTEMPTS) {
				console.error(
					'Trying again. Attempt ' + (attempts + 1) +
					'/' + MAX_DOWNLOAD_ATTEMPTS + '...'
				)
				return crawl(absURL, attempts + 1)
			} else {
				console.error(
					'We\'ve hit the download attempt limit (' +
					MAX_DOWNLOAD_ATTEMPTS + '). Giving up on ' +
					'this path.'
				)
				throw 'FAILED_DOWNLOAD'
			}
		})
		.catch(error => {
			if (error === 'FAILED_DOWNLOAD') {
				// Debug logging for this is already handled above.
				return []
			} else {
				throw error
			}
		})
}

function playlistifyParse(text, absURL) {
	const links = getHTMLLinks(text)
	const verbose = process.argv.includes('--verbose')

	return Promise.all(links.map(link => {
		const [ title, href ] = link

		if (href.endsWith('/')) {
			// It's a directory!

			if (verbose) console.log('[Dir] ' + absURL + href)
			return crawl(absURL + href)
				.then(res => [title, res])
		} else {
			// It's a file!

			if (verbose) console.log('[File] ' + absURL + href)
			return Promise.resolve([title, absURL + href])
		}
	}))
}

if (process.argv.length === 2) {
	console.log('Usage: crawl-recursive http://example.com/example/path')
} else {
	console.log('Crawling URL: ' + process.argv[2])

	let url = process.argv[2]

	if (!(url.endsWith('/'))) {
		url = url + '/'
	}

	crawl(url)
		.then(res => console.log(JSON.stringify(res, null, 2)))
		.catch(err => console.error(err))
}
