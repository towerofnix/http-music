'use strict'

function flattenPlaylist(playlist) {
  // Flattens a playlist, taking all of the non-group items (tracks) at all
  // levels in the playlist tree and returns them as a single-level array of
  // tracks.

  const groups = playlist.filter(x => isGroup(x))
  const nonGroups = playlist.filter(x => !isGroup(x))

  return groups.map(g => flattenPlaylist(getGroupContents(g)))
    .reduce((a, b) => a.concat(b), nonGroups)
}

function filterPlaylistByPathString(playlist, pathString) {
  // Calls filterPlaylistByPath, taking a path string, rather than a parsed
  // path.

  return filterPlaylistByPath(playlist, parsePathString(pathString))
}

function filterPlaylistByPath(playlist, pathParts) {
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

  let match = playlist.find(g => titleMatch(g, false))

  if (!match) {
    match = playlist.find(g => titleMatch(g, true))
  }

  if (match) {
    if (pathParts.length > 1) {
      const rest = pathParts.slice(1)
      return filterPlaylistByPath(getGroupContents(match), rest)
    } else {
      return match
    }
  } else {
    console.warn(`Not found: "${cur}"`)
    return playlist
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

function getGroupTitle(group) {
  return group[0]
}

function getGroupContents(group) {
  return group[1]
}

function isGroup(array) {
  return Array.isArray(array[1])
}

module.exports = {
  flattenPlaylist,
  filterPlaylistByPathString, filterPlaylistByPath,
  removeGroupByPathString, removeGroupByPath,
  getPlaylistTreeString,
  parsePathString,
  getGroupTitle, getGroupContents
}
