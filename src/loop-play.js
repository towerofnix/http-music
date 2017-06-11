'use strict'

const { spawn } = require('child_process')
const promisifyProcess = require('./promisify-process')
const sanitize = require('sanitize-filename')
const tempy = require('tempy')

class DownloadController {
  constructor(picker, downloader) {
    this.process = null
    this.requestingSkipUpNext = false
    this.isDownloading = false

    this.picker = picker
    this.downloader = downloader
  }

  async downloadNext() {
    this.requestingSkipUpNext = false
    this.isDownloading = true

    // We need to actually pick something to download; we'll use the picker
    // (given in the DownloadController constructor) for that.
    // (See pickers.js.)
    const picked = this.picker()

    // If the picker returns null, nothing was picked; that means that we
    // should stop now. No point in trying to play nothing!
    if (picked == null) {
      this.wavFile = null
      return false
    }

    // The picked result is an array containing the title of the track (only
    // really used to display to the user) and an argument to be passed to the
    // downloader. The downloader argument doesn't have to be anything in
    // particular; but typically it's a string containing a URL or file path.
    // It's up to the downloader to decide what to do with it.
    const [ title, downloaderArg ] = picked

    console.log(`Downloading ${title}..\nDownloader arg: ${downloaderArg}`)

    // The "from" file is downloaded by the downloader (given in the
    // DownloadController constructor) using the downloader argument we just
    // got.
    const from = await this.downloader(downloaderArg)

    // The "to" file is simply a WAV file. We give this WAV file a specific
    // name - the title of the track we got earlier, sanitized to be file-safe
    // - so that when `play` outputs the name of the song, it's obvious to the
    // user what's being played.
    const tempDir = tempy.directory()
    const to = tempDir + `/.${sanitize(title)}.wav`

    // Now that we've got the `to` and `from` file names, we can actually do
    // the convertion. We don't want any output from `avconv` at all, since the
    // output of `play` will usually be displayed while `avconv` is running,
    // so we pass `-loglevel quiet` into `avconv`.
    const convertProcess = spawn('avconv', [
      '-loglevel', 'quiet', '-i', from, to
    ])

    // It's handy to store the output WAV file (the "to" file) and the `avconv`
    // process; the WAV file is used later to be played, and the convert
    // process is stored so it can be killed before it finishes.
    this.wavFile = to
    this.process = convertProcess

    // Now it's only a matter of time before the process is finished.
    // Literally; we need to await the promisified version of our convertion
    // child process.
    try {
      await promisifyProcess(convertProcess)
    } catch(err) {
      console.warn("Failed to convert " + title)
      console.warn("Selecting a new track\n")

      // There's a chance we'll fail, though. That could happen if the passed
      // "from" file doesn't actually contain audio data. In that case, we
      // have to attempt this whole process over again, so that we get a
      // different file. (Technically, the picker might always pick the same
      // file; if that's the case, and the convert process is failing on it,
      // we could end up in an infinite loop. That would be bad, since there
      // isn't any guarding against a situation like that here.)
      return await this.downloadNext()
    }

    // If we were requested to skip the up-next track that's currently being
    // downloaded (probably by the user), we'll have to do that now.
    if (this.requestingSkipUpNext) return await this.downloadNext()

    // We successfully downloaded something, and so the downloadNext function
    // is done. We mark that here, so that skipUpNext will know that it'll need
    // to start a whole new downloadNext to have any effect.
    this.isDownloading = false
  }

  skipUpNext() {
    // If we're already in the process of downloading the up-next track, we'll
    // set the requestingSkipUpNext flag to true. downloadNext will use this to
    // cancel its current download and begin new.
    if (this.isDownloading) {
      this.requestingSkipUpNext = true
      this.killProcess()
    }

    // If we aren't currently downloading a track, downloadNext won't
    // automatically be called from the start again, so we need to do that
    // here.
    if (!this.isDownloading) {
      this.downloadNext()
    }
  }

  killProcess() {
    if (this.process) {
      this.process.kill()
    }
  }
}

class PlayController {
  constructor(downloadController) {
    this.playArgs = []
    this.process = null

    this.downloadController = downloadController
  }

  async loopPlay() {
    // Playing music in a loop isn't particularly complicated; essentially, we
    // just want to keep downloading and playing tracks until none is picked.

    await this.downloadController.downloadNext()

    while (this.downloadController.wavFile) {
      const nextPromise = this.downloadController.downloadNext()

      const file = this.downloadController.wavFile
      const playProcess = spawn('play', [...this.playArgs, file])
      const playPromise = promisifyProcess(playProcess)
      this.process = playProcess

      try {
        await playPromise
      } catch(err) {
        console.warn(err)
      }

      await nextPromise
    }
  }

  killProcess() {
    if (this.process) {
      this.process.kill()
    }
  }
}

module.exports = function loopPlay(picker, downloader, playArgs = []) {
  // Looping play function. Takes one argument, the "pick" function,
  // which returns a track to play. Preemptively downloads the next
  // track while the current one is playing for seamless continuation
  // from one song to the next. Stops when the result of the pick
  // function is null (or similar). Optionally takes a second argument
  // used as arguments to the `play` process (before the file name).

  const downloadController = new DownloadController(picker, downloader)

  const playController = new PlayController(downloadController)
  playController.playArgs = playArgs

  const promise = playController.loopPlay()

  return {
    promise,

    skipCurrent: function() {
      playController.killProcess()
    },

    skipUpNext: function() {
      downloadController.skipUpNext()
    },

    kill: function() {
      playController.killProcess()
      downloadController.killProcess()
    }
  }
}
