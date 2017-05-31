'use strict'

const { flattenPlaylist } = require('./playlist-utils')

function makeOrderedPlaylistPicker(playlist) {
  // Ordered playlist picker - this plays all the tracks in a playlist in
  // order, after flattening it.

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
  // Shuffle playlist picker - this selects a random track at any index in
  // the playlist, after flattening it.

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
