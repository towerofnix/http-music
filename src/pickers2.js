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

const { flattenGrouplike } = require('./playlist-utils')

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

function shuffleGroups(grouplike) {
  if (isGroup(grouplike) && grouplike.items.every(isGroup)) {
    const items = shuffleArray(grouplike.items.map(shuffleGroups))
    return Object.assign({}, grouplike, {items})
  } else {
    return grouplike
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

// ----------------------------------------------------------------------------

function sortFlattenGrouplike(grouplike, sort) {
  // Returns a grouplike.
  // TODO: This should accept a seed (which would control how it shuffles)..

  if (sort === 'order' || sort === 'ordered') {
    return {items: flattenGrouplike(grouplike).items}
  }

  if (sort === 'shuffle' || sort === 'shuffled') {
    return {items: shuffleArray(flattenGrouplike(grouplike).items)}
  }

  if (sort === 'shuffle-groups' || sort === 'shuffled-groups') {
    return {items: flattenGrouplike(shuffleGroups(grouplike)).items}
  }
}

function generalPicker(playlist, lastTrack, options) {
  const { sort, loop } = options

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

  const flattened = sortFlattenGrouplike(playlist, sort)

  const index = flattened.items.indexOf(lastTrack)

  if (index === -1) {
    return flattened.items[0]
  }

  if (index + 1 === flattened.items.length) {
    if (loop === 'loop-same-order' || loop === 'loop') {
      return flattened.items[0]
    }

    if (loop === 'loop-regenerate') {
      if (sort === 'shuffle') {
        // TODO: Regenerate shuffle seed. Remember to re-flatten, or else
        // we'll be picking the first track from the old shuffle!
        // options.shuffleSeed = ...
        // flattened.items = sortFlattenPlaylist(.., options.shuffleSeed)
        // Probably best to have a "generate shuffle options" function at the
        // top of the function, which can be called if shuffleSeed is
        // undefined (which it usually will be, on the first run of the
        // picker).
      }

      return flattened.items[0]
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
  const hm = new HistoryController(playlist, generalPicker, {sort: 'ordered', loop: 'loop'})
  hm.fillTimeline()
  console.log(hm.timeline)
  console.log('initial length:', hm.timeline.length)
  for (let i = 0; i < 6; i++) {
    console.log(`(${hm.timelineIndex}) next:`, hm.getNextTrack())
    console.log(`(-> ${hm.timelineIndex}) length:`, hm.timeline.length)
  }

  console.log('setting timeline index to 2 (3)..')
  hm.timelineIndex = 2
  console.log('current:', hm.currentTrack)

  for (let i = 0; i < 6; i++) {
    console.log(`(${hm.timelineIndex}) next:`, hm.getNextTrack())
    console.log(`(-> ${hm.timelineIndex}) length:`, hm.timeline.length)
  }
}
