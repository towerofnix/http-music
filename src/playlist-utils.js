'use strict'

function flattenPlaylist(playlist) {
  const groups = playlist.filter(x => Array.isArray(x[1]))
  const nonGroups = playlist.filter(x => x[1] && !(Array.isArray(x[1])))
  return groups.map(g => flattenPlaylist(g[1]))
    .reduce((a, b) => a.concat(b), nonGroups)
}

function filterPlaylistByPathString(playlist, pathString) {
  return filterPlaylistByPath(playlist, parsePathString(pathString))
}

function filterPlaylistByPath(playlist, pathParts) {
  // Note this can be used as a utility function, rather than just as
  // a function for use by the argv-handler!

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

function ignoreGroupByPathString(playlist, pathString) {
  const pathParts = parsePathString(pathString)
  return ignoreGroupByPath(playlist, pathParts)
}

function ignoreGroupByPath(playlist, pathParts) {
  // TODO: Ideally this wouldn't mutate the given playlist.

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

    const tracksString = (showTracks ? nonGroups.map(g => g[0]).join('\n') : '')

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
