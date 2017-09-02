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
    this.timelineIndex++
    this.fillTimeline()
    return this.currentTrack
  }

  get currentTrack() {
    return this.timeline[this.timelineIndex]
  }
}

// ----------------------------------------------------------------------------

// Test script:

{
  const playlist = [{x: 'A'}, {x: 'B'}, {x: 'C'}, {x: 'D'}]
  const picker = (lastTrack) => {
    if (lastTrack === null) {
      return playlist[0]
    } else {
      const index = playlist.indexOf(lastTrack)
      if (index === -1) {
        return playlist[0]
      } else if (index < playlist.length - 1) {
        return playlist[index + 1]
      } else {
        return playlist[0]
      }
    }
  }
  const hm = new HistoryManager(picker)
  hm.fillTimeline()
  console.log(hm.timeline)
  console.log('initial length:', hm.timeline.length)
  for (let i = 0; i < 6; i++) {
    console.log('next:', hm.getNextTrack())
    console.log('length:', hm.timeline.length)
  }
}
