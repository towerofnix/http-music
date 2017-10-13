'use strict'

const path = require('path')
const fs = require('fs')

const { promisify } = require('util')
const unlink = promisify(fs.unlink)

const parentSymbol = Symbol('Parent group')
const oldSymbol = Symbol('Old track or group reference')

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
    items: [],
    [oldSymbol]: group
  }

  let groupObj = {}

  if (Array.isArray(group[1])) {
    groupObj = {name: group[0], items: group[1]}
  } else {
    groupObj = group
  }

  groupObj = Object.assign(defaultGroup, groupObj)

  groupObj.items = groupObj.items.map(item => {
    // Check if it's a group; if not, it's probably a track.
    if (typeof item[1] === 'array' || item.items) {
      item = updateGroupFormat(item)
    } else {
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
    }

    item[parentSymbol] = groupObj

    return item
  })

  return groupObj
}

function updateTrackFormat(track) {
  const defaultTrack = {
    name: '',
    downloaderArg: '',
    [oldSymbol]: track
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
        return flattenGrouplike(item).items
      } else {
        return [item]
      }
    }).reduce((a, b) => a.concat(b), [])
  }
}

function partiallyFlattenGrouplike(grouplike, resultDepth) {
  // Flattens a grouplike so that it is never more than a given number of
  // groups deep, INCLUDING the "top" group -- e.g. a resultDepth of 2
  // means that there can be one level of groups remaining in the resulting
  // grouplike, plus the top group.

  if (resultDepth <= 1) {
    return flattenGrouplike(grouplike)
  }

  const items = grouplike.items.map(item => {
    if (isGroup(item)) {
      return {items: partiallyFlattenGrouplike(item, resultDepth - 1).items}
    } else {
      return item
    }
  })

  return {items}
}

function collapseGrouplike(grouplike) {
  // Similar to partiallyFlattenGrouplike, but doesn't discard the individual
  // ordering of tracks; rather, it just collapses them all to one level.

  // Gather the groups. The result is an array of groups.
  // Collapsing [Kar/Baz/Foo, Kar/Baz/Lar] results in [Foo, Lar].
  // Aha! Just collect the top levels.
  // Only trouble is what to do with groups that contain both groups and
  // tracks. Maybe give them their own separate group (e.g. Baz).

  const subgroups = grouplike.items.filter(x => isGroup(x))
  const nonGroups = grouplike.items.filter(x => !isGroup(x))

  // Get each group's own collapsed groups, and store them all in one big
  // array.
  const ret = subgroups.map(group => {
    return collapseGrouplike(group).items
  }).reduce((a, b) => a.concat(b), [])

  if (nonGroups.length) {
    ret.unshift({name: grouplike.name, items: nonGroups})
  }

  return {items: ret}
}

function filterGrouplikeByProperty(grouplike, property, value) {
  // Returns a copy of the original grouplike, only keeping tracks with the
  // given property-value pair. (If the track's value for the given property
  // is an array, this will check if that array includes the given value.)

  return Object.assign({}, grouplike, {
    items: grouplike.items.map(item => {
      if (isGroup(item)) {
        const newGroup = filterGrouplikeByProperty(item, property, value)
        if (newGroup.items.length) {
          return newGroup
        } else {
          return false
        }
      } else if (isTrack(item)) {
        const itemValue = item[property]
        if (Array.isArray(itemValue) && itemValue.includes(value)) {
          return item
        } else if (item[property] === value) {
          return item
        } else {
          return false
        }
      } else {
        return item
      }
    }).filter(item => item !== false)
  })
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

function isSameTrack(track1, track2) {
  // Compares the two old-version chains of the given tracks. If there's any
  // overlap, return true, as they are simply different versions of the same
  // track; otherwise, return false.

  // HAHAHA. You cannot convince me this isn't a good usage of generators.
  const chain = function*(track) {
    let oldTrack = track
    while (oldTrack[oldSymbol]) {
      yield (oldTrack = oldTrack[oldSymbol])
    }
  }

  const track2Chain = Array.from(chain(track2))

  for (const oldTrack1 of chain(track1)) {
    if (track2Chain.includes(oldTrack1)) {
      return true
    }
  }

  return false
}

function isGroup(obj) {
  return !!(obj && obj.items)

  // return Array.isArray(array[1])
}

function isTrack(obj) {
  return !!(obj && obj.downloaderArg)

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
  partiallyFlattenGrouplike, collapseGrouplike,
  filterGrouplikeByProperty,
  filterPlaylistByPathString, filterGrouplikeByPath,
  removeGroupByPathString, removeGroupByPath,
  getPlaylistTreeString,
  getItemPathString,
  parsePathString,
  isSameTrack,
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

  console.log('partiallyFlattenGrouplike')

  test: {
    console.log('- ([[a1, [aa1]], out], 2) should return [[a1, aa1], out]')

    const playlist = updatePlaylistFormat({name: 'top', items: [
      {name: 'a', items: [
        {name: 'a1'},
        {name: 'aa', items: [
          {name: 'aa1'}
        ]}
      ]},
      {name: 'out'}
    ]})

    const result = partiallyFlattenGrouplike(playlist, 2)

    console.log('  -> ' + JSON.stringify(result, null))

    // TODO: A nicer way to compare playlists, haha.
    assert(result.items.length, 2)
    assert(result.items[0].items.length, 2)
    assert(result.items[0].items[0].name, 'a1')
    assert(result.items[0].items[1].name, 'aa1')
    assert(result.items[1].name, 'out')
  }

  console.log('collapseGrouplike')

  test: {
    console.log('- (top: [a: [a1, aa: [aa1], a2], out])')

    const playlist = updatePlaylistFormat({name: 'top', items: [
      {name: 'a', items: [
        {name: 'a1'},
        {name: 'aa', items: [
          {name: 'aa1'}
        ]},
        {name: 'a2'}
      ]},
      {name: 'out'}
    ]})

    const result = collapseGrouplike(playlist)

    console.log('  -> ' + JSON.stringify(result, null))

    // output should be [top: [out], a: [a1, a2], aa: [aa1]]
    assert(result.items.length, 3)
    assert(result.items[0].name, 'top')
    assert(result.items[0].items.length, 1)
    assert(result.items[0].items[0].name, 'out')
    assert(result.items[1].name, 'a')
    assert(result.items[1].items.length, 2)
    assert(result.items[1].items[0].name, 'a1')
    assert(result.items[1].items[1].name, 'a2')
    assert(result.items[2].name, 'aa')
    assert(result.items[2].items.length, 1)
    assert(result.items[2].items[0].name, 'aa1')
  }
}
