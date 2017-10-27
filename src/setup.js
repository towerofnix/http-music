'use strict'

const readline = require('readline')
const path = require('path')
const util = require('util')
const fs = require('fs')
const { getCrawlerByName } = require('./crawlers')

const writeFile = util.promisify(fs.writeFile)
const access = util.promisify(fs.access)

async function exists(file) {
  try {
    await access(file)
    return true
  } catch(err) {
    return false
  }
}

function prompt(rl, promptMessage = '', defaultChoice = null, options = {}) {
  return new Promise((resolve, reject) => {
    const hasOptions = (Object.keys(options).length > 0)

    console.log('')

    if (hasOptions) {
      for (const [ option, message ] of Object.entries(options)) {
        if (option === defaultChoice) {
          console.log(`  [${option.toUpperCase()} (default)]: ${message}`)
        } else {
          console.log(`  [${option.toLowerCase()}]: ${message}`)
        }
      }
      console.log('')
    }

    let promptStr = ''

    if (promptMessage) {
      promptStr += promptMessage + ' '
    }

    if (hasOptions) {
      promptStr += '['
      promptStr += Object.keys(options).map(option => {
        if (option === defaultChoice) {
          return option.toUpperCase()
        } else {
          return option.toLowerCase()
        }
      }).join('/')
      promptStr += ']'
    } else if (defaultChoice) {
      promptStr += `[default: ${defaultChoice}]`
    }

    promptStr += '> '

    rl.question(promptStr, choice => {
      toRepeat: {
        if (choice.length === 0 && defaultChoice) {
          resolve(defaultChoice)
        } else if (
          hasOptions && Object.keys(options).includes(choice.toLowerCase())
        ) {
          resolve(choice.toLowerCase())
        } else if (choice.length > 0 && !hasOptions) {
          resolve(choice)
        } else {
          break toRepeat
        }

        console.log('')
        return
      }

      resolve(prompt(rl, promptMessage, defaultChoice, options))
    })
  })
}

async function setupTool() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  console.log('Which source would you like to play music from?')

  const wd = process.cwd()

  const crawlerCommand = {
    l: 'crawl-local',
    h: 'crawl-http'
  }[await prompt(rl, 'Which source?', 'l', {
    l: 'Files on this local computer.',
    h: 'Downloadable files linked from a page on the web.'
  })]

  const crawlerOptions = []

  if (crawlerCommand === 'crawl-local') {
    console.log('What directory would you like to download music from?')
    console.log(`(Your current working directory is: ${wd})`)

    crawlerOptions.push(await prompt(rl, 'What directory path?', '.'))
  }

  if (crawlerCommand === 'crawl-http') {
    console.log('What URL would you like to download music from?')
    console.log('(This only works if the actual song files are linked; you')
    console.log("can't, for example, give a Bandcamp album link here.")

    crawlerOptions.push(await prompt(rl, 'What URL?'))
  }

  console.log('Would you like http-music to automatically process your')
  console.log('playlist to find out which music to play every time?')
  console.log('This is handy if you expect new music to be added to your')
  console.log('source often (e.g. a folder you frequently add new music')
  console.log('to, or a webpage that often has new links added to it).')
  console.log('')
  console.log('If you choose this, http-music may take longer to run.')
  console.log('(If you are loading music from a webpage, then the amount of')
  console.log("time you'll have to wait depends on your internet connection;")
  console.log('if you are loading files from your own computer, the delay')
  console.log('will depend on your hard drive speed - not a big deal, on')
  console.log('most computers.)')

  const useSmartPlaylist = {
    y: true,
    n: false
  }[await prompt(rl, 'Process playlist every time?', 'y', {
    y: 'Yes, process the playlist for new items every time.',
    n: "No, don't automatically process the playlist."
  })]

  console.log("Do you want to save your playlist to a file? If not, you'll")
  console.log('just be given the command you can use to generate the file.')

  const smartPlaylistString = JSON.stringify({
    source: [crawlerCommand, ...crawlerOptions]
  }, null, 2)

  const savePlaylist = {
    y: true,
    n: false
  }[await prompt(rl, 'Save playlist?', 'y', {
    y: 'Yes, save the playlist to a file.',
    n: 'No, just show the command.'
  })]

  if (savePlaylist) {
    console.log('What would you like to name your playlist file?')
    console.log('"playlist.json" will be automatically detected by http-music,')
    console.log('but you can specify a different file or path if you want.')

    let defaultOutput = 'playlist.json'

    const playlistExists = await exists('playlist.json')

    if (playlistExists) {
      console.log('')
      console.log(
        '\x1b[1mBeware!\x1b[0m There is already a file called playlist.json' +
        ' in this'
      )
      console.log(`directory. (Your current working directory is: ${wd})`)
      console.log('You may want to write to another file.')
      defaultOutput = null
    }

    let outputFile = await prompt(rl, 'Playlist file name?', defaultOutput)

    if (path.extname(outputFile) !== '.json') {
      console.log('(http-music playlist files are JSON files, so your file')
      console.log('was changed to a .json file.)')
      console.log('')

      outputFile = path.basename(outputFile, path.extname(outputFile))

      if (playlistExists && path.relative(outputFile, 'playlist') === '') {
        console.log('(Since that would overwrite the playlist.json that already')
        console.log(
          "exists in this directory, it'll instead be saved to playlist2.json.)"
        )
        console.log('')
        outputFile += '2'
      }

      outputFile += '.json'
    }

    if (useSmartPlaylist) {
      await writeFile(outputFile, smartPlaylistString)
    } else {
      console.log('Generating your playlist file. This could take a little while..')
      const { main: crawlerMain } = getCrawlerByName(crawlerCommand)
      const out = await crawlerMain(crawlerOptions, true)
      await writeFile(outputFile, out)
    }

    console.log('Done setting up and saving your playlist file.')
    console.log(`Try it out with \x1b[1mhttp-music play${
      (path.relative(outputFile, 'playlist.json') === '')
      ? ''
      : ` --open ${path.relative('.', outputFile)}`
    }\x1b[0m!`)
  } else {
    if (useSmartPlaylist) {
      console.log("You'll want to create a playlist JSON file containing")
      console.log('the following:')
      console.log('')
      console.log(`\x1b[1m${smartPlaylistString}\x1b[0m`)
    } else {
      console.log(
        `You'll want to use the \x1b[1m${crawlerCommand}\x1b[0m crawler command.`
      )

      if (crawlerOptions.length > 1) {
        console.log(
          'You should give it these arguments:',
          crawlerOptions.map(l => `\x1b[1m${l}\x1b[0m`).join(', ')
        )
      } else if (crawlerOptions.length === 1) {
        const opt = crawlerOptions[0]
        console.log(`You should give it this argument: \x1b[1m${opt}\x1b[0m`)
      }
    }
    console.log('')
  }

  rl.close()
}

module.exports = setupTool

if (require.main === module) {
  setupTool()
    .catch(err => console.error(err))
}
