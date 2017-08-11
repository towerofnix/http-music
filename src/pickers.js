'use strict'

const { flattenGrouplike } = require('./playlist-utils')

function makeLoopingOrderedPlaylistPicker(grouplike) {
  // Looping ordered playlist picker - this plays all the tracks in a group
  // in order, while looping the same order forever.

  const flatGroup = flattenGrouplike(grouplike)
  let index = 0

  return function() {
    if (index >= flatGroup.items.length) {
      index = 0
    }

    const picked = flatGroup.items[index]
    index++
    return picked
  }
}

function makeNonLoopingOrderedPlaylistPicker(grouplike) {
  // Ordered playlist picker - this plays all the tracks in a group in
  // order, after flattening it.

  const flatGroup = flattenGrouplike(grouplike)
  let index = 0

  return function() {
    if (index < flatGroup.items.length) {
      const picked = flatGroup.items[index]
      index++
      return picked
    } else {
      return null
    }
  }
}

function makeLoopingShufflePlaylistPicker(grouplike) {
  // Shuffle playlist picker - this selects a random track at any index in
  // the playlist, after flattening it.

  const flatGroup = flattenGrouplike(grouplike)

  return function() {
    if (flatGroup.items.length) {
      const index = Math.floor(Math.random() * flatGroup.items.length)
      return flatGroup.items[index]
    } else {
      return null
    }
  }
}

function makeNonLoopingShufflePlaylistPicker(grouplike) {
  // No-loop shuffle playlist picker - this takes a playlist and randomly
  // shuffles the order of the items in it, then uses that as an "ordered"
  // playlist (i.e. it plays all the items in it then stops).

  const flatGroup = flattenGrouplike(grouplike)
  const items = shuffleArray(flatGroup.items)

  return function() {
    if (items.length) {
      return items.splice(0, 1)[0]
    } else {
      return null
    }
  }
}

function shuffleArray(array) {
  // Shuffles the items in an array. Super-interesting post on how it works:
  // https://bost.ocks.org/mike/shuffle/

  const workingArray = array.slice(0)

  let m = array.length

  while (m) {
    let i = Math.floor(Math.random() * m)
    m--

    // Stupid lol; avoids the need of a temporary variable!
    Object.assign(workingArray, {
      [m]: workingArray[i],
      [i]: workingArray[m]
    })
  }

  return workingArray
}

module.exports = {
  makeLoopingOrderedPlaylistPicker,
  makeNonLoopingOrderedPlaylistPicker,
  makeLoopingShufflePlaylistPicker,
  makeNonLoopingShufflePlaylistPicker,

  byName: {
    'order':           makeNonLoopingOrderedPlaylistPicker,
    'ordered':         makeNonLoopingOrderedPlaylistPicker,
    'order-loop':      makeLoopingOrderedPlaylistPicker,
    'ordered-loop':    makeLoopingOrderedPlaylistPicker,
    'order-noloop':    makeNonLoopingOrderedPlaylistPicker,
    'ordered-noloop':  makeNonLoopingOrderedPlaylistPicker,
    'order-no-loop':   makeNonLoopingOrderedPlaylistPicker,
    'ordered-no-loop': makeNonLoopingOrderedPlaylistPicker,
    'shuffle':         makeLoopingShufflePlaylistPicker,
    'shuffle-loop':    makeLoopingShufflePlaylistPicker,
    'shuffle-noloop':  makeNonLoopingShufflePlaylistPicker,
    'shuffle-no-loop': makeNonLoopingShufflePlaylistPicker,
  }
}
