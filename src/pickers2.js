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

class HistoryManager {
  constructor(picker) {
    this.picker = picker
    this.timeline = []
    this.timelineIndex = -1 // is 0 upon first getNextTrack

    // Number of tracks that should be picked and placed into the timeline
    // "ahead of time" (i.e. past the timelineIndex).
    this.timelineFillSize = 50
  }

  addNextTrackToTimeline(picker) {
    const lastTrack = this.timeline[this.timeline.length - 1]
    this.timeline.push(this.picker(lastTrack))
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

  getNextTrack() {
    // Moves the timeline index forwards and returns the track at the new index
    // (while refilling the timeline, so that the "up next" list is still full,
    // and so the picker is called if there is no track at the current index).
    this.timelineIndex++
    this.fillTimeline()
    return this.currentTrack
  }

  get currentTrack() {
    // Returns the track in the timeline at the current index.
    return this.timeline[this.timelineIndex]
  }
}

const createOrderedPicker = playlist => {
  const flattened = flattenGrouplike(playlist)

  return lastTrack => {
    if (lastTrack === null) {
      return flattened[0]
    }

    const index = flattened.items.indexOf(lastTrack)

    // Technically, if the index is -1, flattened[0] will be automatically
    // selected, but that isn't really obvious; handling it separately makes
    // it clearer that when we're given a track that's not in the playlist,
    // we just pick the first track in the entire playlist.
    if (index === -1) {
      return flattened.items[0]
    }

    // If we just played the last track, start back from the beginning.
    if (index + 1 === flattened.items.length) {
      return flattened.items[0]
    }

    // Otherwise, we just played some other track in the playlist, so we just
    // pick the next track.
    return flattened.items[index + 1]
  }
}

// ----------------------------------------------------------------------------

// Test script:

{
  const playlist = {items: [{x: 'A'}, {x: 'B'}, {x: 'C'}, {items: [{x: 'D-a'}, {x: 'D-b'}]}, {x: 'E'}]}
  const picker = createOrderedPicker(playlist)
  const hm = new HistoryManager(picker)
  hm.fillTimeline()
  console.log(hm.timeline)
  console.log('initial length:', hm.timeline.length)
  for (let i = 0; i < 6; i++) {
    console.log('next:', hm.getNextTrack())
    console.log('length:', hm.timeline.length)
  }
}
