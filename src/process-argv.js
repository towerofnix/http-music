'use strict'

module.exports = async function processArgv(argv, handlers) {
  let i = 0

  async function handleOpt(opt) {
    if (opt in handlers) {
      await handlers[opt]({
        argv, index: i,
        nextArg: function() {
          i++
          return argv[i]
        },
        alias: function(optionToRun) {
          handleOpt(optionToRun)
        }
      })
    } else {
      console.warn('Option not understood: ' + opt)
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
