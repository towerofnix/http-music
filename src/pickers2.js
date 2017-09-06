const _seedRandom = require('seed-random')

// Pickers should rely on a "state", which is a serializable object that stores data for a given picker "instance".

// Pick-random picker: picks a random track from the entire playlist each time.
// Track order is defined by a seed, which is storeed in state. By looking at the track order calculated by the seed, the picker can decide what track to play after a given other track.
// - Problems:
//   One track can appear twice before another track appears once (i.e. it does not avoid tracks that have already been picked). This is fine (and intetional), but it makes it impossible to say "after this track, play that track". Thus, how should skipping through a track list work?

// Pickers only pick ONE track at a time.
// The history manager may run the picker multiple times to create a list of upcoming tracks which may be presented to the user. This list is useful because the user can then decide to skip ahead in the list if they see a bunch of songs they'd like to hear right away.
// The history manager may keep track of tracks that were previously played, and it should be expected that the user may skip to one of these tracks. If the user skips to a previous track, the upcoming tracks list is NOT recalculated. This is analagous to a book whose pages are randomly added as it is read; when the reader skips back several pages, they should be able to expect to see the following pages in the same order they had previously read them!
// Pickers only know the track that played immediately before the one that is currently to be picked (or null if no tracks have played yet). This is so that a picker can resume at any given track (e.g. so the user can skip ahead - or back - while playing all their music in order).
// Picker state is used to contain information specific to that picker (for example, the seed a shuffle picker uses, or sorting methods).
// Uncertain on how to handle serialization of tracks.. some tracks may appear twice in the same playlist (or two tracks of the same name appear); in this case the serialized path to the two track appearances is the same, when they really refer to two separate instances of the track within the playlist. Could track serialization instead be index-based (rather than name-based)..?

const { flattenGrouplike, isGroup } = require('./playlist-utils')

class HistoryController {
  constructor(playlist, picker, pickerOptions = {}) {
    this.playlist = playlist
    this.picker = picker
    this.pickerOptions = pickerOptions // This is mutable by the picker!

    this.timeline = []
    this.timelineIndex = -1 // Becomes 0 upon first call of getNextTrack.

    // Number of tracks that should be picked and placed into the timeline
    // "ahead of time" (i.e. past the timelineIndex).
    this.timelineFillSize = 50
  }

  addNextTrackToTimeline(picker) {
    const lastTrack = this.timeline[this.timeline.length - 1] || null
    const picked = this.picker(this.playlist, lastTrack, this.pickerOptions)
    this.timeline.push(picked)
  }

  fillTimeline() {
    // Refills the timeline so that there's at least timelineFillSize tracks
    // past the current timeline index (which is considered to be at least 0,
    // i.e. so that while it is -1 initially, the length will still be filled
    // to a length of tilelineFillSize).

    // Math.max is used here because we should always be loading at least one
    // track (the one at the current index)!
    const targetSize = (
      Math.max(this.timelineFillSize, 1) +
      Math.max(this.timelineIndex, 0)
    )

    while (this.timeline.length < targetSize) {
      this.addNextTrackToTimeline()
    }
  }

  getNextTrack(move = true) {
    // Moves the timeline index forwards and returns the track at the new index
    // (while refilling the timeline, so that the "up next" list is still full,
    // and so the picker is called if there is no track at the current index).
    if (move) {
      this.timelineIndex++
      this.fillTimeline()
      return this.currentTrack
    } else {
      return this.timeline[this.timelineIndex + 1]
    }
  }

  getBackTrack(move = true) {
    if (move) {
      if (this.timelineIndex > 0) {
        this.timelineIndex--
      }
      return this.currentTrack
    } else {
      return this.timeline[Math.max(this.timelineIndex - 1, 0)]
    }
  }

  get currentTrack() {
    // Returns the track in the timeline at the current index.
    return this.timeline[this.timelineIndex]
  }
}

function shuffleGroups(grouplike, seed) {
  let newSeed = seed

  if (isGroup(grouplike) && grouplike.items.every(isGroup)) {
    const newItems = []
    for (let item of grouplike.items) {
      const returnGrouplike = shuffleGroups(item, newSeed)

      if (returnGrouplike.hasOwnProperty('newSeed')) {
        newSeed = returnGrouplike.newSeed
        delete returnGrouplike.newSeed
      }

      newItems.push(returnGrouplike)
    }

    const shuffledItems = shuffleArray(newItems, newSeed)
    newSeed = shuffledItems.newSeed
    delete shuffledItems.newSeed

    return Object.assign({}, grouplike, {items: shuffledItems, newSeed})
  } else {
    return grouplike
  }
}

function shuffleArray(array, seed) {
  // Shuffles the items in an array, using a seeded random number generator.
  // (That means giving the same array and seed to shuffleArray will always
  // produce the same results.) Attaches the resulting seed to the return
  // array under the property "newSeed". Super-interesting post on how this
  // all works (though with less seeded-RNG):
  // https://bost.ocks.org/mike/shuffle/

  const workingArray = array.slice(0)
  let newSeed = seed

  let m = array.length

  while (m) {
    // I don't think this is how it's *supposed* to work..?
    newSeed = seedRandom(seed)()
    let i = Math.floor(newSeed * m)
    m--

    // Stupid lol; avoids the need of a temporary variable!
    Object.assign(workingArray, {
      [m]: workingArray[i],
      [i]: workingArray[m]
    })
  }

  return Object.assign(workingArray, {newSeed})
}

function seedRandom(seed = null) {
  // The normal seedRandom function (from NPM) doesn't handle getting
  // undefined as its seed very well; this function is fine with that (and
  // appropriately generates a new seed, as _seedRandom() with no arguments
  // does).

  if (seed === null) {
    return _seedRandom()
  } else {
    return _seedRandom(seed)
  }
}

// ----------------------------------------------------------------------------

function sortFlattenGrouplike(grouplike, sort, seed) {
  // Takes a grouplike (usually a playlist), and returns a flat (only tracks,
  // no groups) version of it, according to a given sorting method. Takes a
  // seed, for random-generation purposes.
  //
  // Returns a grouplike. The modified seed is attached to this grouplike
  // under the "newSeed" property.

  if (sort === 'order' || sort === 'ordered') {
    return {items: flattenGrouplike(grouplike).items}
  }

  // We use Array.from to discard the 'newSeed' property on the return
  // array.

  if (
    sort === 'shuffle' || sort === 'shuffled' ||
    sort === 'shuffle-tracks' || sort === 'shuffled-tracks'
  ) {
    const ret = shuffleArray(flattenGrouplike(grouplike).items, seed)
    const items = Array.from(ret)
    const { newSeed } = ret
    return {items, newSeed}
  }

  if (sort === 'shuffle-groups' || sort === 'shuffled-groups') {
    const shuffled = shuffleGroups(grouplike, seed)
    const { newSeed } = shuffled
    const { items } = flattenGrouplike(shuffled)
    return {items, newSeed}
  }
}

function generalPicker(playlist, lastTrack, options) {
  const { sort, loop } = options

  if (![
    'order', 'ordered', 'shuffle', 'shuffled', 'shuffle-tracks',
    'shuffled-tracks','shuffle-groups', 'shuffled-groups'
  ].includes(sort)) {
    throw new Error(`Invalid sort mode: ${sort}`)
  }

  if (![
    'loop', 'no-loop', 'no', 'loop-same-order', 'loop-regenerate',
    'pick-random'
  ].includes(loop)) {
    throw new Error(`Invalid loop mode: ${loop}`)
  }

  const flattened = sortFlattenGrouplike(playlist, sort, options.seed)
  if (typeof options.seed === 'undefined') {
    options.seed = flattened.newSeed
  }
  delete flattened.newSeed

  const index = flattened.items.indexOf(lastTrack)

  if (index === -1) {
    return flattened.items[0]
  }

  if (index + 1 === flattened.items.length) {
    if (loop === 'loop-same-order' || loop === 'loop') {
      return flattened.items[0]
    }

    if (loop === 'loop-regenerate') {
      // Deletes the random number generation seed then starts over. Assigning
      // a new RNG seed makes it so we get a new shuffle the next time, and
      // clearing the lastTrack value makes generalPicker thinks we're
      // starting over.
      const newSeed = seedRandom(options.seed)()
      options.seed = newSeed
      return generalPicker(playlist, null, options)
    }

    if (loop === 'no-loop' || loop === 'no') {
      // Returning null means the picker is done picking.
      return null
    }
  }

  if (index + 1 > flattened.items.length) {
    throw new Error(
      "Picker index is greater than total item count?" +
      `(${index} > ${topLevel.items.length}`
    )
  }

  if (index + 1 < flattened.items.length) {
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
    /*
    if (loop === 'pick-random') {
      const pickedIndex = Math.floor(Math.random() * topLevel.items.length)
      return topLevel.items[pickedIndex]
    }
    */

    return flattened.items[index + 1]
  }
}

module.exports = {HistoryController, generalPicker}

// ----------------------------------------------------------------------------

// Test script:

if (require.main === module) {
  const playlist = {items: [{x: 'A'}, {x: 'B'}, {x: 'C'}, {items: [{x: 'D-a'}, {x: 'D-b'}]}, {x: 'E'}]}

  console.log('ordered:')
  console.log('- testing to see if timeline fill size works correctly')
  console.log('- initial length should be 4, index -1')
  console.log('- once index becomes 0, length should still be 4')
  console.log('- as index grows, length should increase at same rate')

  const hc = new HistoryController(playlist, generalPicker, {sort: 'ordered', loop: 'loop'})

  hc.timelineFillSize = 4
  hc.fillTimeline()
  console.log(hc.timeline)
  console.log('initial length:', hc.timeline.length)
  for (let i = 0; i < 6; i++) {
    console.log(`(${hc.timelineIndex}) next:`, hc.getNextTrack())
    console.log(`(-> ${hc.timelineIndex}) length:`, hc.timeline.length)
  }

  console.log('setting timeline index to 2 (3rd item)..')
  console.log('- timeline shouldn\'t grow until it gets to 6')
  console.log('  (because currently the timeline is (or should be) 9 (from index=5 + fillSize=4)')
  console.log('  but then, index=6 + fillSize=4 = length=10)')
  console.log('- timeline should then grow at same rate as index')
  hc.timelineIndex = 2
  console.log('current:', hc.currentTrack)

  for (let i = 0; i < 6; i++) {
    console.log(`(${hc.timelineIndex}) next:`, hc.getNextTrack())
    console.log(`(-> ${hc.timelineIndex}) length:`, hc.timeline.length)
  }

  console.log('---------------')
  console.log('shuffle-tracks:')

  console.log('seed = 123; loop = loop-same-order')
  console.log(' - should output the same thing every run')
  console.log(' - the resulting tracks should loop in a cycle')
  const hc_st = new HistoryController(playlist, generalPicker, {sort: 'shuffle-tracks', loop: 'loop-same-order', seed: 123})
  hc_st.timelineFillSize = 20
  hc_st.fillTimeline()
  console.log(hc_st.timeline)

  console.log('seed = 123; loop = loop-regenerate')
  console.log(' - should output the same thing every run')
  console.log(' - the resulting tracks should loop randomly (based on the seed)')
  const hc_st2 = new HistoryController(playlist, generalPicker, {sort: 'shuffle-tracks', loop: 'loop-regenerate', seed: 123})
  hc_st2.timelineFillSize = 20
  hc_st2.fillTimeline()
  console.log(hc_st2.timeline)

  console.log('seed = undefined')
  console.log(' - should output something random each time')
  const hc_st3 = new HistoryController(playlist, generalPicker, {sort: 'shuffle-tracks', loop: 'loop'})
  hc_st3.timelineFillSize = 5
  hc_st3.fillTimeline()
  console.log(hc_st3.timeline)

  console.log('---------------')
  console.log('shuffle-groups:')
  console.log('(different playlist used here)')

  const playlist2 = {items: [
    {items: [
      {x: 'A-a'}, {x: 'A-b'}, {x: 'A-c'}
    ]},
    {items: [
      {x: 'B-a'}, {x: 'B-b'}
    ]},
    {items: [
      {items: [
        {x: 'C-1-a'}, {x: 'C-1-b'}
      ]},
      {items: [
        {x: 'C-2-a'}, {x: 'C-2-b'}
      ]}
    ]}
  ]}

  console.log('seed = baz')
  console.log(' - should output the same thing every time')
  const hc_sg = new HistoryController(playlist2, generalPicker, {sort: 'shuffle-groups', loop: 'loop', seed: '13324iou321324i234123'})
  hc_sg.timelineFillSize = 3 + 2 + (2 + 2)
  hc_sg.fillTimeline()
  console.log(hc_sg.timeline)

  console.log('seed = undefined')
  console.log('- should output something random each time')
  const hc_sg2 = new HistoryController(playlist2, generalPicker, {sort: 'shuffle-groups', loop: 'loop'})
  hc_sg2.timelineFillSize = 3 + 2 + (2 + 2)
  hc_sg2.fillTimeline()
  console.log(hc_sg2.timeline)
}
