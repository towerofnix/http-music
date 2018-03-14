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

const {
  flattenGrouplike, isGroup, updatePlaylistFormat, isSameTrack, oldSymbol,
  getTrackIndexInParent
} = require('./playlist-utils')

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

function shuffleGroups(grouplike, getRandom) {
  if (isGroup(grouplike) && grouplike.items.every(isGroup)) {
    const newItems = []
    for (let item of grouplike.items) {
      const returnGrouplike = shuffleGroups(item, getRandom)
      newItems.push(returnGrouplike)
    }

    const items = shuffleArray(newItems, getRandom)

    return Object.assign({}, grouplike, {items})
  } else {
    return grouplike
  }
}

function shuffleArray(array, getRandom) {
  // Shuffles the items in an array, using a seeded random number generator.
  // (That means giving the same array and seed to shuffleArray will always
  // produce the same results.) Takes a random number generator (Math.random
  // or a seeded RNG will work here). Super-interesting post on how this
  // all works (though with less seeded-RNG):
  // https://bost.ocks.org/mike/shuffle/

  const workingArray = array.slice(0)

  let m = array.length

  while (m) {
    let i = Math.floor(getRandom() * m)
    m--

    // Stupid lol; avoids the need of a temporary variable!
    Object.assign(workingArray, {
      [m]: workingArray[i],
      [i]: workingArray[m]
    })
  }

  return workingArray
}

function makeGetRandom(seed = null) {
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

function sortFlattenGrouplike(grouplike, sort, getRandom) {
  // Takes a grouplike (usually a playlist), and returns a flat (only tracks,
  // no groups) version of it, according to a given sorting method. Takes a
  // seed, for random-generation purposes.

  if (sort === 'order' || sort === 'ordered') {
    return {items: flattenGrouplike(grouplike).items}
  }

  if (['alphabetically', 'alphabetical', 'alphabet', 'az', 'a-z'].includes(sort)) {
    return {items: flattenGrouplike(grouplike).items.sort(
      function (a, b) {
        let { name: aName } = a
        let { name: bName } = b

        const cleanup = str => {
          str = str.trim()
          str = str.toLowerCase()
          str = str.replace(/[^a-zA-Z0-9]/g, '')

          if (/^[0-9]+$/.test(str)) {
            // Do nothing, the string is made of one group of digits and so
            // would be messed up by our sort here if we got rid of those
            // digits.
          } else {
            str = str.replace(/^[0-9]+/, '').trim()
          }

          return str
        }

        aName = cleanup(aName)
        bName = cleanup(bName)

        if (aName < bName) {
          return -1
        } else if (aName === bName) {
          return 0
        } else {
          return +1
        }
      }
    )}
  }

  if (
    sort === 'shuffle' || sort === 'shuffled' ||
    sort === 'shuffle-tracks' || sort === 'shuffled-tracks'
  ) {
    const items = shuffleArray(flattenGrouplike(grouplike).items, getRandom)
    return {items}
  }

  if (sort === 'shuffle-groups' || sort === 'shuffled-groups') {
    const { items } = flattenGrouplike(shuffleGroups(grouplike, getRandom))
    return {items}
  }
}

const playlistCache = Symbol('Cache of indexed playlist')

function generalPicker(sourcePlaylist, lastTrack, options) {
  // (Track 3/5 [2712])   -- Track (CUR/GROUP [ALL])
  // (Track 3/2712)       -- Track (CUR/ALL)

  const { sort, loop } = options

  if (![
    'order', 'ordered', 'shuffle', 'shuffled', 'shuffle-tracks',
    'shuffled-tracks', 'shuffle-groups', 'shuffled-groups',
    'alphabetically', 'alphabetical', 'alphabet', 'a-z', 'az'
  ].includes(sort)) {
    throw new Error(`Invalid sort mode: ${sort}`)
  }

  if (![
    'loop', 'no-loop', 'no', 'loop-same-order', 'loop-regenerate',
    'pick-random'
  ].includes(loop)) {
    throw new Error(`Invalid loop mode: ${loop}`)
  }

  // Regenerating the flattened list is really time-expensive, so we make sure
  // to cache the result of the operation (in the 'options' property, which is
  // used to store "state"-specific data for the picker).
  let playlist
  if (options.hasOwnProperty(playlistCache)) {
    playlist = options[playlistCache]
  } else {
    // TODO: Enable this conditionally.
    // console.log('\x1b[1K\rIndexing (flattening)...')

    if (typeof options.seed === 'undefined') {
      options.seed = Math.random()
    }

    const getRandom = makeGetRandom(options.seed)

    const updatedPlaylist = updatePlaylistFormat(sourcePlaylist)
    const flattened = sortFlattenGrouplike(updatedPlaylist, sort, getRandom)

    playlist = flattened

    options[playlistCache] = playlist

    // TODO: Enable this condtionally.
    // console.log('\x1b[1K\rDone indexing.')
  }

  let index

  decideTrackIndex: {
    if (lastTrack !== null) {
      // The "current" version of the last track (that is, the object
      // representing this track which appears in the flattened/updated/cached
      // playlist).
      const currentLastTrack = playlist.items.find(
        t => isSameTrack(t, lastTrack)
      )

      index = playlist.items.indexOf(currentLastTrack)
    } else {
      index = -1
    }

    if (index === -1) {
      index = 0
      break decideTrackIndex
    }

    if (index + 1 === playlist.items.length) {
      if (loop === 'loop-same-order' || loop === 'loop') {
        index = 0
        break decideTrackIndex
      }

      if (loop === 'loop-regenerate') {
        // Deletes the random number generation seed then starts over. Assigning
        // a new RNG seed makes it so we get a new shuffle the next time, and
        // clearing the lastTrack value makes generalPicker thinks we're
        // starting over. We also need to destroy the playlistCache, or else it
        // won't actually recalculate the list.
        const newSeed = makeGetRandom(options.seed)()
        options.seed = newSeed
        delete options[playlistCache]
        return generalPicker(sourcePlaylist, null, options)
      }

      if (loop === 'no-loop' || loop === 'no') {
        // Returning null means the picker is done picking.
        return null
      }
    }

    if (index + 1 > playlist.items.length) {
      throw new Error(
        "Picker index is greater than total item count?" +
        `(${index + 1} > ${playlist.items.length}`
      )
    }

    if (index + 1 < playlist.items.length) {
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

      index += 1
      break decideTrackIndex
    }
  }

  const oldItem = playlist.items[index]
  const item = Object.assign({}, oldItem, {[oldSymbol]: oldItem})

  item.overallTrackIndex = [index, playlist.items.length]

  if (
    ['order', 'ordered', 'shuffle-groups', 'shuffled-groups'].includes(sort)
  ) {
    item.groupTrackIndex = getTrackIndexInParent(item)
  }

  return item
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

  console.log('---------------')
  console.log('misc. stuff')

  const playlist3 = {items: []}
  for (let i = 0; i < 10000; i++) {
    playlist3.items.push({i})
  }

  console.log('speedtest shuffle-tracks on 10000 items')

  const hc_sp = new HistoryController(playlist3, generalPicker, {sort: 'shuffle-tracks', loop: 'loop'})
  hc_sp.timelineFillSize = playlist3.items.length

  console.time('speedtest10k')
  hc_sp.fillTimeline()
  console.timeEnd('speedtest10k')
}
