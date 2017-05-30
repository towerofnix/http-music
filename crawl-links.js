'use strict'

const fetch = require('node-fetch')
const $ = require('cheerio')
const url = require('url')

const DEFAULT_EXTENSIONS = [
	'mp3', 'wav'
]

function getHTMLLinks(text) {
	// Never parse HTML with a regex!

	return $(text).find('a').get().map(a => {
		const $a = $(a)
		return [$a.text(), $a.attr('href')]
	})
}

module.exports.getHTMLLinks = getHTMLLinks

if (require.main === module) {
	const urlString = process.argv[2]
	const exts = process.argv.length > 3 ? process.argv.slice(3) : DEFAULT_EXTENSIONS

	fetch(urlString)
		.then(res => res.text())
		.then(text => getHTMLLinks(text))
		.then(links => links.filter(l => exts.some(e => l[1].endsWith('.' + e))))
		.then(links => links.map(l => [l[0], url.resolve(urlString, l[1])]))
		.then(links => console.log(JSON.stringify(links, null, 2)))
		.catch(err => console.error(err))
}
