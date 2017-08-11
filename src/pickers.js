'use strict'

const { flattenGrouplike, isGroup } = require('./playlist-utils')

function shuffleGroups(grouplike) {
  if (isGroup(grouplike) && grouplike.items.every(isGroup)) {
    const items = shuffleArray(grouplike.items.map(shuffleGroups))
    return Object.assign({}, grouplike, {items})
  } else {
    return grouplike
  }
}

function makePicker(grouplike, sort, loop) {
  // Options to take into consideration:
  // - How should the top-level be sorted?
  //   (e.g. "order", "shuffle", "shuffle-groups")
  // - How should looping be handled?
  //   (e.g. "loop", "no-loop")
  // - Also keep in mind aliases for all of the above.
  //   (e.g. "ordered", "shuffled", "noloop")
  //
  // What about a shuffle-mode that should simply pick a random track every
  // time?
  //
  // What about a shuffle-mode that re-shuffles the list every time a loop
  // happens?
  //
  // Both of those options could probably be handled via the 'loop' option.

  if (![
    'order', 'ordered', 'shuffle', 'shuffled', 'shuffle-groups',
    'shuffled-groups'
  ].includes(sort)) {
    throw new Error(`Invalid sort mode: ${sort}`)
  }

  if (![
    'loop', 'no-loop', 'no', 'loop-same-order', 'loop-regenerate',
    'pick-random'
  ].includes(loop)) {
    throw new Error(`Invalid loop mode: ${loop}`)
  }

  const topLevel = {items: []}

  let generateTopLevel = () => {
    if (sort === 'order' || sort === 'ordered') {
      topLevel.items = flattenGrouplike(grouplike).items
    }

    if (sort === 'shuffle' || sort === 'shuffled') {
      topLevel.items = shuffleArray(flattenGrouplike(grouplike).items)
    }

    if (sort === 'shuffle-groups' || sort === 'shuffled-groups') {
      topLevel.items = flattenGrouplike(shuffleGroups(grouplike)).items
    }
  }

  generateTopLevel()

  let index = 0

  return function() {
    if (index === topLevel.items.length) {
      if (loop === 'loop-same-order' || loop === 'loop') {
        index = 0
      }

      if (loop === 'loop-regenerate') {
        generateTopLevel()
        index = 0
      }

      if (loop === 'no-loop' || loop === 'no') {
        // Returning null means the picker is done picking.
        // (In theory, we could use an ES2015 generator intead, but this works
        // well enough.)
        return null
      }
    }

    if (index > topLevel.items.length) {
      throw new Error(
        "Picker index is greater than total item count?" +
        `(${index} > ${topLevel.items.length}`
      )
    }

    if (index < topLevel.items.length) {
      // Pick-random is a special exception - in this case we don't actually
      // care about the value of the index variable; instead we just pick a
      // random track from the generated top level.
      //
      // Loop=pick-random is different from sort=shuffle. Sort=shuffle always
      // ensures the same song doesn't play twice in a single shuffle. It's
      // like how when you shuffle a deck of cards, you'll still never pick
      // the same card twice, until you go all the way through the deck and
      // re-shuffle the deck!
      //
      // Loop=pick-random instead picks a random track every time the picker
      // is called. It's more like you reshuffle the complete deck every time
      // you pick something.
      //
      // Now, how should pick-random work when dealing with groups, such as
      // when using sort=shuffle-groups? (If I can't find a solution, I'd say
      // that's alright.)
      if (loop === 'pick-random') {
        const pickedIndex = Math.floor(Math.random() * topLevel.items.length)
        return topLevel.items[pickedIndex]
      }

      // If we're using any other mode, we just want to get the current item
      // in the playlist, and increment the index variable by one (note i++
      // and not ++i; i++ increments AFTER getting i so it gets us the range
      // 0..length-1, whereas ++i increments BEFORE, which gets us the range
      // 1..length.
      return topLevel.items[index++]
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


module.exports = makePicker
