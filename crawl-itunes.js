const fetch = require('node-fetch')

const MAX_DOWNLOAD_ATTEMPTS = 5

function parseDirectoryListing(text) {
	// Matches all links in a directory listing.
	// Returns an array where each item is in the format [href, label].

	if (!(text.includes('Directory listing for'))) {
		throw 'NOT_DIRECTORY_LISTING'
	}

	const regex = /<a href="([^"]*)">([^>]*)<\/a>/g

	let matches, output = []
	while (matches = regex.exec(text)) {
		output.push([matches[1], matches[2]])
	}
	return output
}

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
	const links = parseDirectoryListing(text)
	return Promise.all(links.map(link => {
		const [ href, title ] = link

		const verbose = process.argv.includes('--verbose')

		if (href.endsWith('/')) {
			// It's a directory!

			if (verbose) console.log('[Dir] ' + absURL + href)
			return crawl(absURL + href)
				.then(res => [title, res])
				.catch(error => {
					if (error === 'NOT_DIRECTORY_LISTING') {
						console.error('Not a directory listing: ' + absURL)
						return []
					} else {
						throw error
					}
				})
		} else {
			// It's a file!

			if (verbose) console.log('[File] ' + absURL + href)
			return Promise.resolve([title, absURL + href])
		}
	})).catch(error => {
	})
}

crawl('http://192.168.2.19:1233/')
	.then(res => console.log(JSON.stringify(res, null, 2)))
	.catch(err => console.error(err))
