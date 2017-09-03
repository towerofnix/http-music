const splitChars = str => str.split('').map(char => char.charCodeAt(0))

const simpleKeybindings = {
  space: [0x20],
  esc: [0x1b], escape: [0x1b],
  up: [0x1b, ...splitChars('[A')],
  down: [0x1b, ...splitChars('[B')],
  right: [0x1b, ...splitChars('[C')],
  left: [0x1b, ...splitChars('[D')],
  shiftUp: [0x1b, ...splitChars('[1;2A')],
  shiftDown: [0x1b, ...splitChars('[1;2B')],
  shiftRight: [0x1b, ...splitChars('[1;2C')],
  shiftLeft: [0x1b, ...splitChars('[1;2D')],
  delete: [0x7f]
}

module.exports.compileKeybindings = function(bindings, commands) {
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
      } else if (Object.keys(simpleKeybindings).includes(item)) {
        return simpleKeybindings[item]
      } else if (typeof item === 'string' && item.length === 1) {
        return [item.charCodeAt(0)]
      } else {
        // Error
        console.warn('Invalid keybinding part', item, 'in keybinding', bindings)
        failed = true
        return []
      }
    }).reduce((a, b) => a.concat(b), [])

    if (failed) {
      return
    }

    const buffer = Buffer.from(bufferParts)

    return function(inputData) {
      if (buffer.equals(inputData)) {
        commands[command](...args)
      }
    }
  }).filter(Boolean)

  return function(inputData) {
    for (let handler of handlers) {
      handler(inputData)
    }
  }
}
