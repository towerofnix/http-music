'use strict'

module.exports = {
  getCrawlerByName: function(name) {
    switch (name) {
      case 'crawl-http': return require('./crawl-http')
      case 'crawl-local': return require('./crawl-local')
      case 'crawl-itunes': return require('./crawl-itunes')
      case 'crawl-youtube': return require('./crawl-youtube')
      case 'open-file': return require('./open-file')
      default: return null
    }
  }
}
