'use strict'

const { flattenGrouplike } = require('./playlist-utils')

function makeOrderedPlaylistPicker(grouplike) {
  // Ordered playlist picker - this plays all the tracks in a group in
  // order, after flattening it.

  const allSongs = flattenGrouplike(groupContents)
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

function makeShufflePlaylistPicker(grouplike) {
  // Shuffle playlist picker - this selects a random track at any index in
  // the playlist, after flattening it.

  const flatGroup = flattenGrouplike(grouplike)

  return function() {
    if (flatGroup.items.length) {
      const index = Math.floor(Math.random() * flatGroup.items.length)
      const picked = flatGroup.items[index]
      return picked
    } else {
      return null
    }
  }
}

module.exports = {
  makeOrderedPlaylistPicker,
  makeShufflePlaylistPicker
}
