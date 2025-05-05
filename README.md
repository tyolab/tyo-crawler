# tyo-crawler

This is a web crawler built using Node.js and Puppeteer, designed for flexible and powerful web scraping and data extraction. It supports various features like link following, pattern matching, cookie handling, local storage interaction, and more. It uses Redis for link caching and management.

## Features

*   **Headless Browser Support:** Leverages Puppeteer for interacting with websites as a real browser.
*   **Redis Integration:** Uses Redis for efficient link caching and management, preventing duplicate crawls.
*   **Configurable Crawling:** Offers a wide range of options to customize the crawling process.
*   **Pattern Matching:** Allows defining patterns to filter URLs to be crawled.
*   **Cookie Handling:** Supports saving and using cookies during crawling.
*   **Local Storage Interaction:** Can read and use data from local storage files.
*   **Action Execution:** Can execute predefined actions on web pages.
*   **Cloning:** Supports cloning websites by downloading all matching resources.
*   **Exclusion/Inclusion:** Allows defining lists of URLs to exclude or include during crawling.
*   **Curl Integration:** Can use `curl` for downloading resources.
*   **Seed URL Support:** Can start crawling from multiple seed URLs.
*   **Wait Times:** Configurable wait times for page loading and between crawls.
* **View Only:** Can be used to just view the page without downloading.

## Installation

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/e-tang/tyo-crawler.git
    cd tyo-crawler
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    ```

3.  **Redis:** Ensure you have Redis installed and running.

    ```bash
    # Install Redis (example for Ubuntu)
    sudo apt-get update
    sudo apt-get install redis-server

    # Start Redis
    sudo systemctl start redis-server
    ```

    Alternatively, you can use Docker / Docker Compose provided in the repository to run Redis:
    
    ```bash
    cd tyo-crawler
    cd docker
    docker-compose up -d
    ```

## Breakdown of Each Parameter

### `"click": null`
- **Type:** string (CSS selector) or null  
- **Purpose:** Specifies a CSS selector. If provided, the crawler will attempt to click on the element matching this selector on each page it visits. Useful for interacting with dynamic content (e.g., loading more items, navigating through pagination).  
- **Default:** `null` (no clicking).  

### `"show-window": false`
- **Type:** boolean  
- **Purpose:** Determines whether the browser window should be visible during the crawl.  
  - `true`: The browser is visible.  
  - `false` (default): The browser runs in headless mode.  
- **Default:** `false` (headless).  

### `"with-browser": true`
- **Type:** boolean  
- **Purpose:** Controls whether to use a full browser (Puppeteer) for crawling.  
  - `true` (default): Uses Puppeteer.  
  - `false`: Uses curl or wget, which is faster but doesn’t execute JavaScript.  
- **Default:** `true` (use browser).  

### `"next-crawl-wait-time": 31`
- **Type:** number (seconds)  
- **Purpose:** Sets the wait time (in seconds) between crawling each subsequent page to avoid overloading the server.  
- **Default:** `31` seconds.  

### `"level": -1`
- **Type:** number  
- **Purpose:** Defines the maximum depth of links to follow.  
  - `-1`: Unlimited depth.  
  - `0`: Only crawl the initial URL(s).  
  - `1`: Crawl the initial URL(s) and links found on those pages.  
  - `n`: Crawl up to `n` levels deep.  
- **Default:** `-1` (unlimited).  

### `"pattern": null`
- **Type:** string (regular expression) or null  
- **Purpose:** A regular expression to filter URLs. Only matching URLs will be crawled.  
- **Default:** `null` (crawl all links).  

### `"han": false`
- **Type:** boolean  
- **Purpose:** If `true`, the hostname of the first URL is used as the Redis namespace.  
- **Default:** `false` (default namespace: `tmp`).  

### `"co": []`
- **Type:** array  
- **Purpose:** Placeholder for additional custom options.  
- **Default:** `[]` (empty array).  

### `"output": null`
- **Type:** string (file path) or null  
- **Purpose:** Specifies where to save the content of a single crawled URL.  
- **Default:** `null` (no output file).  

### `"dbhost": "localhost"`
- **Type:** string  
- **Purpose:** The hostname or IP address of the Redis server.  
- **Default:** `"localhost"`.  

### `"dbport": 6379`
- **Type:** number  
- **Purpose:** The port number of the Redis server.  
- **Default:** `6379`.  

### `"with-cookies": false`
- **Type:** boolean  
- **Purpose:** Enables or disables cookie handling.  
- **Default:** `false` (no cookie handling).  

### `"webroot": "./www"`
- **Type:** string (directory path)  
- **Purpose:** The root directory where downloaded files are saved.  
- **Default:** `"./www"`.  

### `"clone": false`
- **Type:** boolean  
- **Purpose:** Enables website cloning mode, downloading all resources (images, CSS, JavaScript, etc.).  
- **Default:** `false`.  

### `"path-pattern": null`
- **Type:** string (URL path) or null  
- **Purpose:** Specifies the URL path to match for cloning.  
- **Default:** `null` (no specific path).  

### `"exclude": []`
- **Type:** array of strings (regular expressions)  
- **Purpose:** URLs matching any of these patterns will be excluded.  
- **Default:** `[]` (no exclusions).  

### `"include": []`
- **Type:** array of strings (regular expressions)  
- **Purpose:** Only URLs matching any of these patterns will be included.  
- **Default:** `[]` (no specific inclusions).  

### `"with-curl": false`
- **Type:** boolean  
- **Purpose:** Uses curl to download resources instead of the browser.  
- **Default:** `false`.  

### `"viewonly": false`
- **Type:** boolean  
- **Purpose:** If `true`, the crawler only views pages without downloading them.  
- **Default:** `false`.  

### `"seed": false`
- **Type:** boolean  
- **Purpose:** Enables seed mode, allowing multiple starting URLs.  
- **Default:** `false`.  

### `"local-storage": null`
- **Type:** string (file path) or null  
- **Purpose:** Path to a JSON file containing local storage data to inject into the browser.  
- **Default:** `null`.  

### `"actions-file": null`
- **Type:** string (file path) or null  
- **Purpose:** Path to a JSON file containing actions to perform on pages.  
- **Default:** `null`.  

### `"wait-time": 1200`
- **Type:** number (milliseconds)  
- **Purpose:** Default wait time (in milliseconds) before the next crawl.  
- **Default:** `1200` ms (1.2 seconds).  

### `"browser-wait-time": 0`
- **Type:** number (milliseconds)  
- **Purpose:** Default wait time for the browser to wait after a page loads.  
- **Default:** `0` milliseconds.  

## Usage

The crawler is executed via the `index.js` file using Node.js with the parameter(s) explained above.

For example, to crawl a webpage with specific options, you can run:
```bash
node index.js --show-window true example.com/awesome-page
```

But some pages may require authentication or other actions. In such cases, you can create a JSON file with the desired options and run the crawler with that file. Please see `actions.example.json` for an example configuration.

```bash
node crawler.js --actions-file actions.json --show-window true example.com/login
```

## TODO
-   There are a lot to do
-   COOKIES (--with-cookies) is not working