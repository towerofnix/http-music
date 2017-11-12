const splitChars = str => str.split('').map(char => char.charCodeAt(0))

const simpleKeybindings = {
  space: ['Space', [0x20]],
  esc: ['Escape', [0x1b]],
  escape: ['Escape', [0x1b]],
  up: ['Up', [0x1b, ...splitChars('[A')]],
  down: ['Down', [0x1b, ...splitChars('[B')]],
  right: ['Right', [0x1b, ...splitChars('[C')]],
  left: ['Left', [0x1b, ...splitChars('[D')]],
  shiftUp: ['Shift+Up', [0x1b, ...splitChars('[1;2A')]],
  shiftDown: ['Shift+Down', [0x1b, ...splitChars('[1;2B')]],
  shiftRight: ['Shift+Right', [0x1b, ...splitChars('[1;2C')]],
  shiftLeft: ['Shift+Left', [0x1b, ...splitChars('[1;2D')]],
  delete: ['Backspace', [0x7f]],
  backspace: ['Backspace', [0x7f]]
}

module.exports.compileKeybindings = function(bindings, commands) {
  // The "commands" array is an optional argument - if not given, the resulting
  // handler function will simply return the keybinding array for whichever
  // matches the inputted keypress. Too bad this feature isn't used anywhere.
  // Thanks, old me.

  const handlers = bindings.map(binding => {
    const [ keys, command, ...args] = binding

    if (!commands.hasOwnProperty(command)) {
      console.warn('Invalid command', command, 'in keybinding', binding)
      return
    }

    let failed = false

    const bufferParts = keys.map(item => {
      if (typeof item === 'number') {
        return [item]
      } else if (simpleKeybindings.hasOwnProperty(item)) {
        return simpleKeybindings[item][1]
      } else if (typeof item === 'string' && item.length === 1) {
        return [item.charCodeAt(0)]
      } else {
        console.warn(
          'Invalid keybinding part', item, 'in keybinding', bindings
        )
        failed = true
        return []
      }
    }).reduce((a, b) => a.concat(b), [])

    if (failed) {
      return
    }

    const buffer = Buffer.from(bufferParts)

    return async function(inputData) {
      if (buffer.equals(inputData)) {
        if (commands) {
          const result = await commands[command](...args)
          return typeof result === 'undefined' ? true : result
        } else {
          return keybinding
        }
      }
    }
  }).filter(Boolean)

  return async function(inputData) {
    for (const handler of handlers) {
      const result = await handler(inputData)
      if (typeof result !== 'undefined') {
        return result
      }
    }
  }
}

module.exports.getComboForCommand = function(command, bindings) {
  const binding = bindings.find(kb => kb[1] === command)
  if (binding) {
    return binding[0]
  } else {
    return null
  }
}

module.exports.stringifyCombo = function(combo) {
  const stringifiedItems = combo.map(item => {
    if (typeof item === 'string') {
      if (item.length === 1) {
        return item.toUpperCase()
      } else if (simpleKeybindings.hasOwnProperty(item)) {
        return simpleKeybindings[item][0]
      } else {
        return item
      }
    } else {
      return JSON.stringify(item)
    }
  })

  return stringifiedItems.join('+')
}
