'use strict'

// TODO: Use this when loading playlists. Also grab things from http-music.js.
function updatePlaylistFormat(playlist) {
  const defaultPlaylist = {
    items: [],
    options: []
  }

  let playlistObj = {}

  // Playlists can be in two formats...
  if (Array.isArray(playlist)) {
    // ..the first, a simple array of tracks and groups;

    playlistObj = {items: playlist}
  } else {
    // ..or an object including metadata and configuration as well as the
    // array described in the first.

    playlistObj = playlist

    // The 'tracks' property was used for a while, but it doesn't really make
    // sense, since we also store groups in the 'tracks' property. So it was
    // renamed to 'items'.
    if ('tracks' in playlistObj) {
      playlistObj.items = playlistObj.tracks
      delete playlistObj.tracks
    }
  }

  const fullPlaylistObj = Object.assign(defaultPlaylist, playlistObj)

  const handleGroupContents = groupContents => {
    return groupContents.map(item => {
      if (Array.isArray(item[1])) {
        return {name: item[0], items: handleGroupContents(item[1])}
      } else {
        return updateTrackFormat(item)
      }
    })
  }

  fullPlaylistObj.items = handleGroupContents(fullPlaylistObj.items)

  return fullPlaylistObj
}

function updateTrackFormat(track) {
  const defaultTrack = {
    name: '',
    downloaderArg: ''
  }

  let trackObj = {}

  if (Array.isArray(track)) {
    if (track.length === 2) {
      trackObj = {name: track[0], downloaderArg: track[1]}
    } else {
      throw new Error("Unexpected non-length 2 array-format track")
    }
  } else {
    trackObj = track
  }

  return Object.assign(defaultTrack, trackObj)
}

function updateGroupFormat(group) {
  const defaultGroup = {
    name: '',
    items: []
  }

  let groupObj

  if (Array.isArray(group)) {
    if (group.length === 2) {
      groupObj = {name: group[0], items: group[1]}
    } else {
      throw new Error("Unexpected non-length 2 array-format group")
    }
  } else {
    groupObj = group
  }

  return Object.assign(defaultGroup, groupObj)
}

function mapGrouplikeItems(grouplike, handleTrack) {
  if (typeof handleTrack === 'undefined') {
    throw new Error("Missing track handler function")
  }

  return {
    items: grouplike.items.map(item => {
      if (isTrack(item)) {
        return handleTrack(item)
      } else if (isGroup(item)) {
        return mapGrouplikeItems(item, handleTrack, handleGroup)
      } else {
        throw new Error('Non-track/group item')
      }
    })
  }
}

function flattenGrouplike(grouplike) {
  // Flattens a group-like, taking all of the non-group items (tracks) at all
  // levels in the group tree and returns them as a new group containing those
  // tracks.

  return {
    items: grouplike.items.map(item => {
      if (isGroup(item)) {
        return flattenGrouplike(item).items
      } else {
        return [item]
      }
    }).reduce((a, b) => a.concat(b), [])
  }
}

function filterPlaylistByPathString(playlist, pathString) {
  // Calls filterGroupContentsByPath, taking an unparsed path string.

  return filterGroupContentsByPath(playlist, parsePathString(pathString))
}

function filterGroupContentsByPath(groupContents, pathParts) {
  // Finds a group by following the given group path and returns it. If the
  // function encounters an item in the group path that is not found, it logs
  // a warning message and returns the group found up to that point.

  const titleMatch = (group, caseInsensitive = false) => {
    let a = getGroupTitle(group)
    let b = cur

    if (caseInsensitive) {
      a = a.toLowerCase()
      b = b.toLowerCase()
    }

    return a === b || a === b + '/'
  }

  const cur = pathParts[0]

  let match = groupContents.find(g => titleMatch(g, false))

  if (!match) {
    match = groupContents.find(g => titleMatch(g, true))
  }

  if (match) {
    if (pathParts.length > 1) {
      const rest = pathParts.slice(1)
      return filterGroupContentsByPath(getGroupContents(match), rest)
    } else {
      return match
    }
  } else {
    console.warn(`Not found: "${cur}"`)
    return groupContents
  }
}

function removeGroupByPathString(playlist, pathString) {
  // Calls removeGroupByPath, taking a path string, rather than a parsed path.

  return removeGroupByPath(playlist, parsePathString(pathString))
}

function removeGroupByPath(playlist, pathParts) {
  // Removes the group at the given path from the given playlist.

  const groupToRemove = filterPlaylistByPath(playlist, pathParts)

  const parentPath = pathParts.slice(0, pathParts.length - 1)
  let parent

  if (parentPath.length === 0) {
    parent = playlist
  } else {
    parent = getGroupContents(filterPlaylistByPath(playlist, parentPath))
  }

  const index = parent.indexOf(groupToRemove)

  if (index >= 0) {
    parent.splice(index, 1)
  } else {
    console.error(
      `Group ${pathParts.join('/')} doesn't exist, so we can't explicitly ` +
      "ignore it."
    )
  }
}

function getPlaylistTreeString(playlist, showTracks = false) {
  function recursive(group) {
    const groups = group.filter(x => isGroup(x))
    const nonGroups = group.filter(x => !isGroup(x))

    const childrenString = groups.map(group => {
      const title = getGroupTitle(group)
      const groupString = recursive(getGroupContents(group))

      if (groupString) {
        const indented = groupString.split('\n').map(l => '| ' + l).join('\n')
        return '\n' + title + '\n' + indented
      } else {
        return title
      }
    }).join('\n')

    let tracksString = ''
    if (showTracks) {
      tracksString = nonGroups.map(g => getGroupTitle(g)).join('\n')
    }

    if (tracksString && childrenString) {
      return tracksString + '\n' + childrenString
    } else if (childrenString) {
      return childrenString
    } else if (tracksString) {
      return tracksString
    } else {
      return ''
    }
  }

  return recursive(playlist)
}

function parsePathString(pathString) {
  const pathParts = pathString.split('/')
  return pathParts
}

// TODO: Are these two functions actually useful??
function getGroupTitle(group) {
  return group[0]
}

function getGroupContents(group) {
  return group[1]
}

function isGroup(obj) {
  return obj && obj.items

  // return Array.isArray(array[1])
}

function isTrack(obj) {
  return obj && obj.downloaderArg

  // return typeof array[1] === 'string'
}

module.exports = {
  updatePlaylistFormat, updateTrackFormat,
  flattenGrouplike,
  filterPlaylistByPathString, filterGroupContentsByPath,
  removeGroupByPathString, removeGroupByPath,
  getPlaylistTreeString,
  parsePathString,
  getGroupTitle, getGroupContents,
  isGroup, isTrack
}
