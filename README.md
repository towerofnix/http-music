# `http-music`

## http-music's code is no longer updated on GitHub

Please check out [https://git.ed1.club/florrie/http-music.git][git] instead.

  [git]: https://git.ed1.club/florrie/http-music.git

---

![Play demo](screenshots/hm-basic-usage.png)
![Local crawl demo](screenshots/hm-crawllocal.png)

A command line program that lets you download music from places (like the
internet, or your hard drive) and play it. It's also
[decently powerful](#screenshots).

## Installation

```bash
$ git clone https://github.com/towerofnix/http-music
$ cd http-music
$ npm install

# Installs http-music GLOBALLY, i.e., so you can use from in any directory.
$ npm link # (You might need sudo here.)

# (Hey, you! That one person who only reads the install code! Please also
# read the "you will also need" section below.)
```

**You will also need:**

* **A player:** [`play` (from SoX)][sox] and [`mpv`][mpv] both work. You'll
  only need one of these, but mpv gives you access to play/pause and seeking
  controls.

* **A sound converter:** either [`avconv`][libav] or [`ffmpeg`][ffmpeg] will
  work.

* **Optionally,** [`youtube-dl`][ytdl] lets you [play][apply] music from
  [just about anywhere][moresites] (rather than just
  `http://blah/foo.mp3`-like URLs!).

There's a fair chance you already have some of these installed; you can always
check from your terminal using the [`type`][type] command!

## Usage

```
# Generate a playlist file, using the handy interactive setup utility..
$ http-music setup

# ..or one of these shell commands:
$ http-music crawl-http http://some.directory.listing.server/ > playlist.json
$ http-music crawl-local ~/Music/ > playlist.json

# Then play it:
$ http-music play

# (You can use `python3 -m http.server` or `python2 -m SimpleHTTPServer` to
# run a quick and easy directory listing, to pass into crawl-http!)
```

## Screenshots

**Super-basic usage (`http-music play`):**

![Basic usage](screenshots/hm-basic-usage.png)

**Load music from the file system (`http-music crawl-local . > playlist.json`):**

![Local crawl](screenshots/hm-crawllocal.png)

**Load music from an HTTP server (<code>http-music crawl-http http://<a href="https://stackoverflow.com/q/7943751/4633828">some.directory.listing</a></code>):**

![Crawl HTTP](screenshots/hm-remote.png)

**Filter by a specific group (`http-music play --clear --keep 'C418/one'`):**

(A shorthand also works! Try `http-music play -c -k C418/one`.)

![Clear/keep](screenshots/hm-clearkeep.png)

**Visually look at the longest tracks in a playlist:**

![Duration graph](screenshots/hm-duration-graph.png)

## Documentation

Check out [the man pages](man/). (Or view them with `man http-music`.)

  [sox]: http://sox.sourceforge.net/
  [mpv]: https://mpv.io/
  [libav]: https://www.libav.org/
  [ffmpeg]: https://www.ffmpeg.org/
  [type]: https://unix.stackexchange.com/a/10529/125775
  [ytdl]: http://rg3.github.io/youtube-dl/
  [moresites]: http://rg3.github.io/youtube-dl/supportedsites.html
  [apply]: https://gist.github.com/towerofnix/cd7465a82c8b367eef221e61c3b6186e

