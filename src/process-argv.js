'use strict'

module.exports = async function processArgv(argv, handlers) {
  // Basic command line argument list processor. Takes a list of arguments and
  // an object, which is used as a mapping of option strings to behavior
  // functions.

  let i = 0

  async function handleOpt(opt) {
    // Handles a single option. May be recursive, depending on the user-defined
    // handler given to processArgv. If there is no such handler for the given
    // option, a warning message is displayed and the option is ignored.

    if (opt in handlers) {
      await handlers[opt]({
        // Util object; stores useful information and methods that the handler
        // can access.

        argv, index: i,

        nextArg: function() {
          // Returns the next argument in the argument list, and increments
          // the parse index by one.

          i++
          return argv[i]
        },

        alias: function(optionToRun) {
          // Runs the given option's handler.

          return handleOpt(optionToRun)
        }
      })
    } else {
      console.warn("Option not understood: " + opt)
    }
  }

  for (; i < argv.length; i++) {
    const cur = argv[i]
    if (cur.startsWith('-')) {
      const opt = cur.slice(1)
      await handleOpt(opt)
    }
  }
}
