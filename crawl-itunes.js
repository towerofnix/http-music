const fetch = require('node-fetch')

function parseDirectoryListing(text) {
	// Matches all links in a directory listing.
	// Returns an array where each item is in the format [href, label].

	if (!(text.includes('Directory listing for'))) {
		console.warn("Not a directory listing! Crawl returning empty array.")
		return []
	}

	const regex = /<a href="([^"]*)">([^>]*)<\/a>/g

	let matches, output = []
	while (matches = regex.exec(text)) {
		output.push([matches[1], matches[2]])
	}
	return output
}

function crawl(absURL) {
	return fetch(absURL)
		.then(res => res.text(), err => {
			console.warn('FAILED: ' + absURL)
			return 'Oops'
		})
		.then(text => parseDirectoryListing(text))
		.then(links => Promise.all(links.map(link => {
			const [ href, title ] = link

			if (href.endsWith('/')) {
				// It's a directory!

				console.log('[Dir] ' + absURL + href)
				return crawl(absURL + href).then(res => [title, res])
			} else {
				// It's a file!

				console.log('[File] ' + absURL + href)
				return Promise.resolve([title, absURL + href])
			}
		})))
}

crawl('http://192.168.2.19:1233/')
	.then(res => console.log(JSON.stringify(res, null, 2)))
	.catch(err => console.error(err))
