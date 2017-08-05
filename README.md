# `http-music`

A command line program that lets you download music from places and play it.
It's also decently powerful.

## Installation

```bash
$ git clone https://github.com/towerofnix/http-music
$ cd http-music
$ npm install

# Installs http-music GLOBALLY, i.e., so you can use from in any directory.
$ npm link # (You might need sudo here.)
```

## Usage

```
# Generate a playlist file, using one of these shell commands..
$ http-music crawl-http http://some.directory.listing.server/ > playlist.json
$ http-music crawl-local ~/Music/ > playlist.json

# Then play it:
$ http-music play

# (You can use `python3 -m http.server` or `python2 -m SimpleHTTPServer` to
# run a quick and easy directory listing, to pass into crawl-http!)
```

## Documentation

Check out [the man pages](man/). (Or view them with `man http-music`.)
