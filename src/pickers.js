'use strict'

const { flattenPlaylist } = require('./playlist-utils')

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

module.exports = {
  makeOrderedPlaylistPicker,
  makeShufflePlaylistPicker
}
