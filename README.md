# tyo-crawler

A web crawler built on Node.js and Puppeteer. It can fetch a single page, follow links across a site, clone a site to disk, log in by running scripted actions, and hand each page to a processor (for example to turn Evernote notes or X posts into Markdown). Redis tracks which links have been seen, so a crawl can be stopped and resumed.

## Features

* **Real browser:** pages are loaded in Puppeteer (headless by default), so JavaScript-built pages work.
* **Redis link tracking:** every link's status is stored in Redis, which prevents duplicate crawls and lets a crawl resume.
* **Seed and clone modes:** start from one or many URLs, follow matching links, or download a whole site with its assets.
* **Host filtering:** limit the crawl with `--pattern`, `--include` and `--exclude`.
* **Scripted actions:** type, click, wait, scroll, switch into iframes, set cookies or storage, and more, driven by a JSON file. See [ACTIONS.md](ACTIONS.md).
* **Cookies and local storage:** reuse a logged-in session, load cookies from a file, or inject local storage.
* **Processors:** plug in a script that receives each page and extracts what you need (`processors/evernote.js`, `processors/x.js`).
* **curl downloads:** optionally download files with `curl` instead of the browser.

## Installation

1. **Clone the repository**

    ```bash
    git clone https://github.com/tyolab/tyo-crawler.git
    cd tyo-crawler
    ```

2. **Install dependencies** (Puppeteer downloads its own Chromium; use Node.js 18 or later)

    ```bash
    npm install
    ```

3. **Run Redis.** The crawler connects to Redis on `localhost:6379`.

    Either install it:

    ```bash
    sudo apt-get update
    sudo apt-get install redis-server
    sudo systemctl start redis-server
    ```

    or use the Docker Compose file in `docker/`:

    ```bash
    cd docker
    docker compose up -d
    ```

    The compose file uses the `bitnami/redis` image, which runs as user 1001, so the `docker/data` folder must be writable by that user (`sudo chown -R 1001:1001 docker/data`). It publishes port 6379 on all interfaces with no password. On a machine others can reach, change the port mapping to `127.0.0.1:6379:6379`.

## Usage

The entry point is `index.js`. Pass options first and the URL last:

```bash
# fetch one page (no link following)
node index.js --show-window true https://example.com/some-page

# follow links on the same host
node index.js --seed true https://example.com/

# clone a site to ./www, including its assets
node index.js --clone true https://example.com/

# log in with scripted actions, then crawl
node index.js --actions-file ./examples/actions.example.json --show-window true https://example.com/login
```

Notes:

* Without `--seed` or `--clone`, only the URL you give is processed. Links on it are not followed.
* `--actions-file` and `--local-storage` files are loaded with `require()`, so use a path starting with `./` or an absolute path. `--actions-file actions.json` (no `./`) fails.
* Using `--links-file` turns on seed mode.
* Re-running the same crawl does nothing for links Redis already has marked as done. To start over, clear the namespace, for example `redis-cli --scan --pattern 'tmp:*' | xargs redis-cli del` (or the host name if you used `--han true`).

## Options

Boolean options take `true` or `false`, for example `--clone true`.

### Crawl mode and scope

| Option | Default | What it does |
|---|---|---|
| `--seed` | `false` | Follow links from the starting URL(s). Turned on automatically by `--clone` and `--links-file`. |
| `--clone` | `false` | Download the site and its assets (HTML, images, CSS, JS) under `--webroot`. Implies `--seed`. |
| `--links-file` | `null` | Text file with one URL per line to use as seeds. |
| `--pattern` | `null` | Regular expression matched against the **host name** of each link. Only matching hosts are crawled. If you pass it more than once, only the last value is kept, so combine alternatives into one regex (`'a\.com\|b\.com'`). |
| `--path-pattern` | `null` | In clone mode, only download URLs under this path. Ignored outside clone mode. |
| `--include` | `[]` | Host-name patterns to allow. In clone mode, links to other hosts are only followed if they match. |
| `--exclude` | `[]` | Host-name patterns to skip. |
| `--index-pattern` | `[]` | URL patterns that identify index pages. |
| `--refresh-index` | `false` | Re-fetch index pages even if they were crawled before. |
| `--han` | `false` | Use the first URL's host name as the Redis namespace instead of `tmp`. |
| `--level` | `-1` | Intended to limit crawl depth. **Currently not applied** (see Known issues). |

### Browser and timing

| Option | Default | What it does |
|---|---|---|
| `--show-window` | `false` | Show the browser window instead of running headless. Useful when writing actions. |
| `--with-browser` | `true` | Load pages in Puppeteer. |
| `--browser-wait-time` | `0` | Page-load timeout in milliseconds (`0` means the 30-second default). It is not a pause after the page loads. |
| `--wait-time` | `1200` | In clone mode, the pause in milliseconds after more than 6 pages in a row from the same host. Not used in other modes. |
| `--next-crawl-wait-time` | `31` | Defined but currently not used. |
| `--click` | `null` | CSS selector to click on each page. |
| `--viewonly` | `false` | Don't save the first page; just view it. |

### Sessions, actions and processing

| Option | Default | What it does |
|---|---|---|
| `--actions-file` | `null` | JSON file of actions to run on matching pages. See [ACTIONS.md](ACTIONS.md) and `examples/`. |
| `--with-cookies` | `false` | Save cookies to Redis after a page loads and reuse them on later visits to the same host. |
| `--cookies-file` | `null` | JSON file of cookies to set before the first page. |
| `--local-storage` | `null` | JSON file of local storage values to inject. |
| `--processor` | `null` | Processor to run on each page: a name from `processors/` (such as `evernote` or `x`), or an absolute path to your own (`.js` is added if missing). |

### Output

| Option | Default | What it does |
|---|---|---|
| `--webroot` | `./www` | Where downloaded files are written. |
| `--output` | `null` | When fetching a single URL, save it to this file. |
| `--change-link` | `true` | In clone mode, rewrite links in saved pages to point at the local copies. |
| `--exists-quit` | `false` | Intended to stop when a file being saved already exists. Currently not used. |
| `--with-curl` | `false` | Download files with `curl` instead of the browser. |

### Redis

| Option | Default | What it does |
|---|---|---|
| `--dbhost` | `localhost` | Redis host. **Currently ignored** (see Known issues). |
| `--dbport` | `6379` | Redis port. **Currently ignored** (see Known issues). |

## Actions

Actions let the crawler log in, dismiss pop-ups or work inside iframes before a page is processed. Each entry has an `if` (a CSS selector) and a `then` list of actions that run when the selector is found:

```json
[
  {
    "if": "#login-form",
    "then": [
      { "action": "type", "selector": "input[name='username']", "value": "your_username" },
      { "action": "type", "selector": "input[name='password']", "value": "your_password" },
      { "action": "click", "selector": "button[type='submit']", "on": true }
    ]
  }
]
```

Supported actions include `click`, `type`, `wait`, `scroll`, `screenshot`, `evaluate`, `eval`, `process`, `iframe`, `goto`, `reload`, `download`, `pull`, `setCookie`, `saveCookies`, `setLocalStorage`, `setSessionStorage`, `close`, `exit` and `hold`. A plain `click` waits for a page navigation afterwards. `hold` only logs a message; it does not stop the crawl.

Keep real usernames and passwords out of git: copy an example to a file that isn't committed.

See [ACTIONS.md](ACTIONS.md) for details, and `examples/` for working files (`actions.example.json`, `evernote.example.json`, `x.example.json`).

## Security notes

* Cookies saved with `--with-cookies` are stored in Redis unencrypted.
* TLS certificate checks are turned off for downloads (`rejectUnauthorized = false`, and `curl -k` with `--with-curl`).
* The crawler does not read `robots.txt`. Crawl politely and only where you're allowed to.

## Known issues

* **`--dbhost` and `--dbport` are ignored.** `index.js` passes `{host, port: opts.port}` to the Redis client, but the option is `dbport`, and node-redis v4 expects `{socket: {host, port}}`. The client always connects to `localhost:6379`.
* **`--level` is not applied.** The depth check compares against a `level` value that `crawl_options` never sets.
* **`--next-crawl-wait-time` and `--exists-quit` are not used** anywhere in the crawl loop.
* **`--with-curl` doesn't quote URLs** in the `curl` command, so URLs containing `&` or spaces break.
* Single-page mode may not exit by itself after it finishes. Press Ctrl+C if it doesn't.

## Licence

See [LICENSE](LICENSE).
