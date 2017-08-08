const npmCommandExists = require('command-exists')

module.exports = async function commandExists(command) {
  // When the command-exists module sees that a given command doesn't exist, it
  // throws an error instead of returning false, which is not what we want.

  try {
    return await npmCommandExists(command)
  } catch(err) {
    return false
  }
}
