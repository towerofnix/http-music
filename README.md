# `http-music`

A command line program that lets you download music from places and play it.
It's also decently powerful.

## Using the thing

```bash
# On the server; that is, the device that holds the media:
$ cd my_music_folder
$ python3 -m http.server <some_port>

# On the client; that is, the device with http-music:
$ cd http-music
$ yarn  # to install Node.js dependencies; you'll also need `avconv` and `play` (sox).
$ node crawl-recursive.js <server_ip> > playlist.json
$ node play.js  # Go!
```

**Zomg command line arguments????** — Yes; read the end of the `play.js` file.
There's a bunch of JS-comment-based documentation there.
