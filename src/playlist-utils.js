'use strict'

const path = require('path')
const fs = require('fs')

const { promisify } = require('util')
const unlink = promisify(fs.unlink)

const parentSymbol = Symbol('Parent group')

function updatePlaylistFormat(playlist) {
  const defaultPlaylist = {
    options: [],
    items: []
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

  return updateGroupFormat(fullPlaylistObj)
}

function updateGroupFormat(group) {
  const defaultGroup = {
    name: '',
    items: []
  }

  let groupObj = {}

  if (Array.isArray(group[1])) {
    groupObj = {name: group[0], items: group[1]}
  } else {
    groupObj = group
  }

  groupObj = Object.assign(defaultGroup, groupObj)

  groupObj.items = groupObj.items.map(item => {
    // Theoretically this wouldn't work on downloader-args where the value
    // isn't a string..
    if (typeof item[1] === 'string' || item.downloaderArg) {
      item = updateTrackFormat(item)

      // TODO: Should this also apply to groups? Is recursion good? Probably
      // not!
      //
      // TODO: How should saving/serializing handle this? For now it just saves
      // the result, after applying. (I.e., "apply": {"foo": "baz"} will save
      // child tracks with {"foo": "baz"}.)
      if (groupObj.apply) {
        Object.assign(item, groupObj.apply)
      }
    } else {
      item = updateGroupFormat(item)
    }

    item[parentSymbol] = groupObj

    return item
  })

  return groupObj
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
        const flat = flattenGrouplike(item).items

        return flat
      } else {
        return [item]
      }
    }).reduce((a, b) => a.concat(b), [])
  }
}

function filterPlaylistByPathString(playlist, pathString) {
  // Calls filterGroupContentsByPath, taking an unparsed path string.

  return filterGrouplikeByPath(playlist, parsePathString(pathString))
}

function filterGrouplikeByPath(grouplike, pathParts) {
  // Finds a group by following the given group path and returns it. If the
  // function encounters an item in the group path that is not found, it logs
  // a warning message and returns the group found up to that point. If the
  // pathParts array is empty, it returns the group given to the function.

  if (pathParts.length === 0) {
    return grouplike
  }

  const titleMatch = (group, caseInsensitive = false) => {
    let a = group.name
    let b = pathParts[0]

    if (caseInsensitive) {
      a = a.toLowerCase()
      b = b.toLowerCase()
    }

    return a === b || a === b + '/'
  }

  let match = grouplike.items.find(g => titleMatch(g, false))

  if (!match) {
    match = grouplike.items.find(g => titleMatch(g, true))
  }

  if (match) {
    if (pathParts.length > 1) {
      const rest = pathParts.slice(1)
      return filterGrouplikeByPath(match, rest)
    } else {
      return match
    }
  } else {
    console.warn(`Not found: "${pathParts[0]}"`)
    return grouplike
  }
}

function removeGroupByPathString(playlist, pathString) {
  // Calls removeGroupByPath, taking a path string, rather than a parsed path.

  return removeGroupByPath(playlist, parsePathString(pathString))
}

function removeGroupByPath(playlist, pathParts) {
  // Removes the group at the given path from the given playlist.

  const groupToRemove = filterGrouplikeByPath(playlist, pathParts)

  if (playlist === groupToRemove) {
    console.error(
      'You can\'t remove the playlist from itself! Instead, try --clear' +
      ' (shorthand -c).'
    )

    return
  }

  if (!(parentSymbol in groupToRemove)) {
    console.error(
      `Group ${pathParts.join('/')} doesn't have a parent, so we can't` +
      ' remove it from the playlist.'
    )

    return
  }

  const parent = groupToRemove[parentSymbol]

  const index = parent.items.indexOf(groupToRemove)

  if (index >= 0) {
    parent.items.splice(index, 1)
  } else {
    console.error(
      `Group ${pathParts.join('/')} doesn't exist, so we can't explicitly ` +
      'ignore it.'
    )
  }
}

function getPlaylistTreeString(playlist, showTracks = false) {
  function recursive(group) {
    const groups = group.items.filter(x => isGroup(x))
    const nonGroups = group.items.filter(x => !isGroup(x))

    const childrenString = groups.map(group => {
      const name = group.name
      const groupString = recursive(group)

      if (groupString) {
        const indented = groupString.split('\n').map(l => '| ' + l).join('\n')
        return '\n' + name + '\n' + indented
      } else {
        return name
      }
    }).join('\n')

    let tracksString = ''
    if (showTracks) {
      tracksString = nonGroups.map(g => g.name).join('\n')
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

function getItemPath(item) {
  if (item[parentSymbol]) {
    return [...getItemPath(item[parentSymbol]), item]
  } else {
    return [item]
  }
}

function getItemPathString(item) {
  // Gets the playlist path of an item by following its parent chain.
  //
  // Returns a string in format Foo/Bar/Baz, where Foo and Bar are group
  // names, and Baz is the name of the item.
  //
  // Unnamed parents are given the name '(Unnamed)'.
  // Always ignores the root (top) group.
  //
  // Requires that the given item be from a playlist processed by
  // updateGroupFormat.

  // Check if the parent is not the top level group.
  // The top-level group is included in the return path as '/'.
  if (item[parentSymbol]) {
    const displayName = item.name || '(Unnamed)'

    if (item[parentSymbol][parentSymbol]) {
      return getItemPathString(item[parentSymbol]) + '/' + displayName
    } else {
      return '/' + displayName
    }
  } else {
    return '/'
  }
}

function parsePathString(pathString) {
  const pathParts = pathString.split('/').filter(item => item.length)
  return pathParts
}

function isGroup(obj) {
  return obj && obj.items

  // return Array.isArray(array[1])
}

function isTrack(obj) {
  return obj && obj.downloaderArg

  // return typeof array[1] === 'string'
}

async function safeUnlink(file, playlist) {
  if (!playlist) {
    throw new Error('No playlist given to safe-unlink.')
  }

  // TODO: Is it good to call this every time? - But flattening a list probably
  // isn't THAT big of a task.
  const flat = flattenGrouplike(playlist)

  if (
    flat.items.some(t => path.resolve(t.downloaderArg) === path.resolve(file))
  ) {
    throw new Error(
      'Attempted to delete a file path found in the playlist.json file - ' +
      'this is almost definitely a bug!'
    )
  }

  try {
    await unlink(file)
  } catch(err) {
    if (err.code === 'ENOENT') {
      console.trace(
        `Attempted to delete file "${file}" which does not exist. This ` +
        'could be because of a temporary file being automatically deleted ' +
        'by the system before now, or because of http-music attempting to ' +
        'delete a temporary file which it has already deleted; otherwise ' +
        'this is almost certainly a bug.'
      )
    } else {
      throw err
    }
  }
}

module.exports = {
  parentSymbol,
  updatePlaylistFormat, updateTrackFormat,
  flattenGrouplike,
  filterPlaylistByPathString, filterGrouplikeByPath,
  removeGroupByPathString, removeGroupByPath,
  getPlaylistTreeString,
  getItemPathString,
  parsePathString,
  isGroup, isTrack,
  safeUnlink
}

if (require.main === module) {
  const compareArrays = (a, b) => {
    return a.length === b.length && a.every((x, i) => b[i] === x)
  }

  const _assert = (value, condition) => {
    if (condition(value)) {
      console.log('  ..good.')
    } else {
      console.log('  BAD! result:', value)
    }
  }

  const assert = (value, expectedValue) => {
    return _assert(value, x => x === expectedValue)
  }

  const assertArray = (value, expectedValue) => {
    return _assert(value, x => compareArrays(x, expectedValue))
  }

  console.log('compareArrays')

  {
    console.log('- ([a, b], [a, b]) should return true')
    assert(compareArrays(['a', 'b'], ['a', 'b']), true)
  }

  {
    console.log('- ([a, b], [30, 20]) should return false')
    assert(compareArrays(['a', 'b'], [30, 20]), false)
  }

  {
    console.log('- ([a, b], [a, b, c]) should return false')
    assert(compareArrays(['a', 'b'], ['a', 'b', 'c']), false)
  }

  console.log('getItemPathString')

  {
    console.log('- (root with name) should return /a/b/c/Foo')

    const playlist = updatePlaylistFormat(
      {name: 'root', items: [
        {name: 'a', items: [
          {name: 'b', items: [
            {name: 'c', items: [
              {name: 'Foo'}
            ]}
          ]}
        ]}
      ]}
    )

    const deepTrack = playlist.items[0].items[0].items[0].items[0]

    assert(getItemPathString(deepTrack), '/a/b/c/Foo')
  }

  {
    console.log('- (root without name) should return /a/b/c/Foo')

    const playlist = updatePlaylistFormat(
      {items: [
        {name: 'a', items: [
          {name: 'b', items: [
            {name: 'c', items: [
              {name: 'Foo'}
            ]}
          ]}
        ]}
      ]}
    )

    const deepTrack = playlist.items[0].items[0].items[0].items[0]

    assert(getItemPathString(deepTrack), '/a/b/c/Foo')
  }

  {
    console.log('- (sub-group without name) should return /a/b/(Unnamed)/c/Foo')

    const playlist = updatePlaylistFormat(
      {items: [
        {name: 'a', items: [
          {name: 'b', items: [
            {items: [
              {name: 'c', items: [
                {name: 'Foo'}
              ]}
            ]}
          ]}
        ]}
      ]}
    )

    const deepTrack = playlist.items[0].items[0].items[0].items[0].items[0]

    assert(getItemPathString(deepTrack), '/a/b/(Unnamed)/c/Foo')
  }

  {
    console.log('- (path string of root) should return /')

    const playlist = updatePlaylistFormat({items: []})

    assert(getItemPathString(playlist), '/')
  }

  console.log('parsePathString')

  {
    console.log('- (foo/bar/baz) should return [foo, bar, baz]')
    assertArray(parsePathString('foo/bar/baz'), ['foo', 'bar', 'baz'])
  }

  {
    console.log('- (/foo/bar/baz) should return [foo, bar, baz]')
    assertArray(parsePathString('/foo/bar/baz'), ['foo', 'bar', 'baz'])
  }

  {
    console.log('- (/) should return []')
    assertArray(parsePathString('/'), [])
  }

  {
    console.log('- (/////foo) should return [foo]')
    assertArray(parsePathString('/////foo'), ['foo'])
  }

  {
    console.log('- (//foo/////bar//) should return [foo, bar]')
    assertArray(parsePathString('//foo/////bar//'), ['foo', 'bar'])
  }
}
