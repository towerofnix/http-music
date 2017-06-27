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
$ yarn  # to install Node.js dependencies; you'll also need `avconv` and `mpv`.
$ npm run crawl-http -- <server_ip> > playlist.json
$ node .  # Go!
```

**Zomg command line arguments documentation????** — Yes; read the docs! There's
a man page for a reason: `man man/http-music.1` (or `man http-music`).

There's actually three proper ways to run `http-music`:

* **Run `$ npm link` and then use `$ http-music`.** This gives you the
  advantage of having a proper command you can use anywhere; however it does
  mean installing to /usr/bin (or wherever your `npm-link` command puts
  things).

* **Run `$ node .` while `cd`'d into `http-music`.** This is essentially the
  same as using `npm-link`, but it requires you to be in the repository folder.
  That's alright if you're developing, or just directly downloaded the entire
  repository, but probably isn't otherwise useful.

* **Run `$ npm run play`.** (You might need to do `$ npm run http-music play`.)
  This way *works*, but it's not suggested; command line arguments need to be
  passed after `--`, e.g. `npm run play -- -c -k CoolArtist123` instead of
  `node . -c -k CoolArtist123` or `http-music -c -k CoolArtist123`. Use
  whatever you prefer, I guess.

**If you're running with `npm run`,** you need to use `--` before any of your
own options, e.g. `npm run play -- -c -k CoolArtist123`. I know, it looks
stupid; but it's really just the way `npm run` works. You're probably better
off with `node .` while `cd`'d into the `http-music` directory, or maybe you'd
rather `npm link` it so you can use it anywhere.
