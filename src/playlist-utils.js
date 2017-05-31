'use strict'

function flattenPlaylist(playlist) {
  // Flattens a playlist, taking all of the non-group items (tracks) at all
  // levels in the playlist tree and returns them as a single-level array of
  // tracks.

  const groups = playlist.filter(x => Array.isArray(x[1]))
  const nonGroups = playlist.filter(x => x[1] && !(Array.isArray(x[1])))
  return groups.map(g => flattenPlaylist(g[1]))
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

  let cur = pathParts[0]

  const match = playlist.find(g => g[0] === cur || g[0] === cur + '/')

  if (match) {
    const groupContents = match[1]
    if (pathParts.length > 1) {
      const rest = pathParts.slice(1)
      return filterPlaylistByPath(groupContents, rest)
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
    parent = filterPlaylistByPath(playlist, pathParts.slice(0, -1))
  }

  const index = parent.indexOf(groupToRemove)

  if (index >= 0) {
    parent.splice(index, 1)
  } else {
    console.error(
      'Group ' + pathParts.join('/') + ' doesn\'t exist, so we can\'t ' +
      'explicitly ignore it.'
    )
  }
}

function getPlaylistTreeString(playlist, showTracks = false) {
  function recursive(group) {
    const groups = group.filter(x => Array.isArray(x[1]))
    const nonGroups = group.filter(x => x[1] && !(Array.isArray(x[1])))

    const childrenString = groups.map(g => {
      const groupString = recursive(g[1])

      if (groupString) {
        const indented = groupString.split('\n').map(l => '| ' + l).join('\n')
        return '\n' + g[0] + '\n' + indented
      } else {
        return g[0]
      }
    }).join('\n')

    let trackString = ''
    if (showTracks) {
      trackString = nonGroups.map(g => g[0]).join('\n')
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

module.exports = {
  flattenPlaylist,
  filterPlaylistByPathString, filterPlaylistByPath,
  ignoreGroupByPathString, ignoreGroupByPath,
  parsePathString
}
