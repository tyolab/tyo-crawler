'use strict'

const async = require('async');
const exec = require('child_process').exec;
const puppeteer = require('puppeteer'); // Use Puppeteer instead of Nightmare
// Removed Nightmare and its download manager:
// const Nightmare = require('nightmare');
// require('nightmare-download-manager')(Nightmare);

const {setTimeout} = require("node:timers/promises");

const cheerio = require('cheerio');
const crypto = require('crypto');

const local_utils = require('./utils')

var http = require('follow-redirects').http;
var https = require('follow-redirects').https;
const fs = require('fs');
const path = require('path');

const RedisClient = require('./redis');

// Import events module
var events = require('events');
const { PassThrough } = require('stream');
const utils = require('node-programmer/utils');
const { type } = require('node:os');
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.424';

// As a website crawler, we don't care about the certificate
https.globalAgent.options.rejectUnauthorized = false;

// Define default browser options (mapping roughly to your Nightmare defaults)
const BROWSER_DEFAULT_OPTIONS = {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1200, height: 1024 },
    ignoreDefaultArgs: ['--enable-automation']
};

function Crawler(opts) {
    this.options = this.options || {};

    // crawl mode (0: single file, 1: single website, 2: multiple websites)
    this.options.crawl_mode = this.options.crawl_mode || 2;

    this.webroot = opts["webroot"] || './';
    this.with_browser = opts["with-browser"] || false; // flag now triggers use of Puppeteer
    this.show_window = opts["show-window"] || false;
    this.take_screenshot = opts["take-screenshot"] || -1; 

    this.opts = {};
    // Merge any provided options with the default browser options.
    this.opts.browser = utils.deep_merge(BROWSER_DEFAULT_OPTIONS, opts.browser);
    // Adjust headless mode based on the show_window flag:
    this.opts.browser.headless = !this.show_window;
    this.opts.user_agent = opts['user-agent'] || USER_AGENT;

    // For keys 
    this.redis_client = new RedisClient({
        ...opts.redis,
        version: 4,
    });

    local_utils.hasher = this.redis_client.create_hash_from_url;

    this.idle = 1;
    this.index = -1;

    // Create an event emitter
    this.eventEmitter = new events.EventEmitter();

    // For maintaining downloads (Puppeteer does not have a built-in download event)
    this.downloads = new Map();

    // Last file processed
    this.last_file = null;

    // crawl_options
    this.crawl_options = {};

    // use 'index_pattern' to check if the page is an index page
    this.index_pattern = opts["index-pattern"] || [];
}

// Async initialization: launch Puppeteer browser and open a new page.
Crawler.prototype.initialize = async function () {
    var self = this;

    if (this.with_browser) {
        if (!this.browser) {
            // Launch Puppeteer browser
            let browserOptions = {
                headless: this.opts.browser.headless,
                // args: this.opts.browser.args,
                defaultViewport: this.opts.browser.defaultViewport,
                // executablePath: this.opts.browser.executablePath,
                // ignoreDefaultArgs: this.opts.browser.ignoreDefaultArgs,
                // userDataDir: this.opts.browser.userDataDir,
                // devtools: this.show_window,
                ignoreDefaultArgs: ['--enable-automation'],
                // dumpio: true,
                // slowMo: 0,
                // timeout: this.opts.browser.waitTimeout || 60000,
                // handleSIGINT: true,
                // handleSIGTERM: true,
            }
            this.browser = await puppeteer.launch(browserOptions);
            this.page = await this.browser.newPage();
            // this.page.setDefaultNavigationTimeout(this.opts.browser.waitTimeout || 60000);
            // await this.page. setJavaScriptEnabled(true);
            // await this.page.setRequestInterception(true);
            // await this.page.setCacheEnabled(true);

            if (this.opts.user_agent) {
                await this.page.setUserAgent(this.opts.user_agent);
            }
            // (Optional) Set up download behavior if needed:
            // const client = await this.page.target().createCDPSession();
            // await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: path.resolve(self.webroot) });
        }
    }
    self.index = 0;
};

Crawler.prototype.is_index_page = function (url) {
    // go through the index_pattern and check if the link is an index page
    if (this.index_pattern && this.index_pattern.length > 0) {
        for (let i = 0; i < this.index_pattern.length; i++) {
            const pattern = this.index_pattern[i];
            if (url.match(pattern)) {
                return true;
            }
        }
    }
    return false;
}

Crawler.prototype.curl = async function (link, cb) {
    var command = "curl -k -s -o " + link.file + " " + link.url;
    return new Promise((resolve, reject) => {
        exec(command, function (error, stdout, stderr) {
            if (error !== null || (stderr && stderr.length > 0)) {
              console.log('exec error: ' + error);
            }
            cb(error);
            resolve();
        });
    });
};

Crawler.prototype.download = async function (link, cb) {
    var self = this;

    if (link.type && link.type === 'image') {
        if (link.url.startsWith('blob:')) {
            // Handle blob URL
            await self.download_blob_image(link, cb);
            return;
        }
        else if (link.url.startsWith('data:')) {
            // Handle data URL
            const base64Data = link.url.split(',')[1];
            fs.writeFileSync(link.file, base64Data, { encoding: 'base64' });
            if (cb && typeof cb === 'function') {
                cb();
            }
            return;
        }
    }

    var file = fs.createWriteStream(link.file);
    var web = (link.parsedUrl.protocol === 'https:') ? https : http;
    return new Promise((resolve, reject) => {
        web.get({
            host: link.parsedUrl.host,
            path: link.parsedUrl.path,
        }, function (response) {
            const responseUrl = response.responseUrl || link.url;
            response.on('finish', function() {
                console.log("request finished");
            });
            response.on('end', function() {
                console.log("request ended");
                file.end();
            });
            file.on('close', function () {
                file.close(function () {
                    if (!link.binary) {
                        var fileData = fs.readFileSync(link.file);
                        var result;
                        if (link.url !== responseUrl) {
                            const parsedResponseUrl = new URL(responseUrl);
                            var responseFile = self.create_dest_file(responseUrl, { webroot: self.webroot });
                            result = {
                                href: responseUrl,
                                protocol: parsedResponseUrl.protocol,
                                host: parsedResponseUrl.host
                            };
                            result.baseurl = parsedResponseUrl.protocol + "//" + parsedResponseUrl.host + (responseFile ? responseFile.path : '');
                        }
                        else {
                            result = {
                                href: link.url,
                                protocol: link.parsedUrl.protocol,
                                host: link.parsedUrl.host
                            }
                            result.baseurl = link.parsedUrl.protocol + "//" + link.parsedUrl.host + link.path;
                        }
                        self.process_html(fileData, result,
                            () => {
                                cb();
                            });
                    }
                    else {
                        cb();
                    }
                    resolve();
                });
            });
            response.pipe(file);
        })
        .on('error', (err) => {
            console.error(err);
            cb(err);
            resolve();
        });
    });
};

Crawler.prototype.download_blob_image = async function (link, cb) {
    try {
        let outputPath = link.file;
        // Evaluate the blob URL and convert it to a Base64 string
        // await this.page.waitForSelector('img[src^="blob:"]'); // Wait 
        // for the blob image to appear
        // try {
        //     // await this.page.waitForNavigation({ waitUntil: 'networkidle2' }) // Wait for navigation to complete
            
        //     // await for the blob image (link.url) to appear
        //     await this.page.waitForSelector(`img[src="${link.url}"]`, { timeout: 1000 });
        // } catch (err) {
        //     console.error("Error waiting for navigation:", err);
        // }

        const base64Data = await this.page.evaluate(async (blobUrl, retries = 3) => {
            // const element = document.querySelector(selector);
            // if (!element) {
            //     throw new Error(`Element with selector "${selector}" not found`);
            // }

            // const blobUrl = element.src; // Assuming the blob URL is in the `src` attribute
            for (let i = 0; i < retries; i++) {
                try {
                    const response = await fetch(blobUrl);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch blob: ${response.statusText}`);
                    }
                    const blob = await response.blob();

                    // Convert the blob to a Base64 string
                    return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result.split(',')[1]); // Remove the "data:image/*;base64," prefix
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                }
                catch (err) {
                    console.warn(`Retrying fetch for blob URL: ${blobUrl} (${i + 1}/${retries})`);
                    if (i === retries - 1) throw err;
                }
            }
        }, /* blobSelector */link.url);

        // Save the Base64 data as an image file
        fs.writeFileSync(outputPath, base64Data, { encoding: 'base64' });
        console.log(`Image saved to ${outputPath}`);

        await setTimeout(1000); // Wait for 1 second before resolving

        console.log("Blob image downloaded successfully: ", link.url);
    } catch (err) {
        console.error("Error downloading blob image:", err);
    }
}

Crawler.prototype.process_url = async function (crawled_url, options, resolve) {
    var normalisedUrl;
    var self = this;
    if (options && typeof options == 'function') {
        resolve = options;
        options = null;
    }
    try {
        normalisedUrl = crawled_url;
        if (normalisedUrl && normalisedUrl.length) {
            await self.redis_client.add_link(normalisedUrl);
        }
    } catch (err) {
        console.error(err);
    }
    finally {
        resolve();
    }
};

const pattern1 = /^(.*\.(htm|html|pdf|txt|xlsx|xls|ppt|pptx|doc|docx|jpg|jpeg|png|css|js))$/i;
const pattern2 = /^(.*\.(pdf|txt|xlsx|xls|ppt|pptx|doc|docx|jpg|jpeg|png|css|js))$/i;
Crawler.prototype.get_levels = (url_path) => {
    return (url_path.match(/\//g) || []).length;
};

Crawler.prototype.create_dest_file = function (url, options) {
    // options = options || {};
    // var self = this;
    // var ext;
    // var local_path = options.path || self.local_path;
    // var parsedUrl;
    // try{
    //     parsedUrl = new URL(url);
    // }
    // catch (err) {
    //     console.error(err);
    //     return null;
    // }
    // const whichPath = (typeof local_path !== 'undefined' && local_path !== null) ? local_path : parsedUrl.host;
    // const localArchivePath = path.resolve(self.webroot || './', whichPath);
    // var htmlFile;
    // var lastChar = null;
    // var parentDir;
    // var matchedPattern2 = false;
    // var destFile;
    // var pathname = parsedUrl.pathname;
    // // we need to unescape the pathname
    // try {
    //     pathname = decodeURIComponent(pathname);
    // }
    // catch (err) {
    //     console.error(err);
    //     pathname = parsedUrl.pathname; // just use the original pathname then
    // }
    // try {
    //     lastChar = pathname[pathname.length - 1];
    // } catch (err) { console.error(err) }
    
    // if (lastChar && lastChar === '/') {
    //     htmlFile = 'index.html';
    //     parentDir = pathname;
    //     ext = ".html";
    // }
    // else {
    //     var lastSegment = path.basename(pathname);
    //     parentDir = local_path ? '' : pathname.substr(0, pathname.length - lastSegment.length);
    //     if (lastSegment.match(pattern1)) {
    //         if (lastSegment.match(pattern2))
    //             matchedPattern2 = true;
    //     }
    //     var pos = lastSegment.lastIndexOf('.');
    //     if (!ext) {
    //         if (pos > -1) {
    //             ext = lastSegment.substring(pos, pathname.length);
    //             htmlFile = lastSegment;
    //         }
    //         else
    //             ext = options.ext;
    //     }
    //     if (!htmlFile) {
    //         htmlFile = lastSegment + (parsedUrl.search ? parsedUrl.search : '') + (ext || '');
    //     }
    // }
    // var destParent = path.resolve(localArchivePath, './' + parentDir);
    // try {
    //     if (!fs.existsSync(destParent))
    //         fs.mkdirSync(destParent, { recursive: true });
    // }
    // catch (err) { console.error(err); }
    // if (ext && ext.length > 0)
    //     destFile = path.resolve(destParent, htmlFile);
    // return {
    //     name: htmlFile,
    //     parsedUrl: parsedUrl,
    //     url: url,
    //     path: parentDir,
    //     file: destFile,
    //     binary: matchedPattern2,
    //     dir: destParent,
    //     hash: self.redis_client.create_hash_from_url(parsedUrl)
    // };
    let file = local_utils.create_dest_file(url, options);
    if (file && !file.hash) {
        file.hash = self.redis_client.create_hash_from_url(file.parsedUrl);
    }
    return file;
};

Crawler.prototype.process_html = function (html, result, options, resolve) {
    var self = this;
    const $ = cheerio.load(html);
    if (options && typeof options == 'function') {
        resolve = options;
        options = null;
    }
    options = options || {};
    var excludes = options.excludes || [];
    if (typeof excludes == "string") {
        excludes = [excludes];
    }
    var includes = options.includes || [];
    if (typeof includes == "string") {
        includes = [includes];
    }
    if (!Array.isArray(excludes))
        throw new Error("The excludes type must be an array");
    if (!Array.isArray(includes))
        throw new Error("The includes type must be an array");
    const link_selectors = options.clone ? "a, link, img" : "a";
    async.eachSeries($(link_selectors), (elem, done) => {
        var type = "html";
        if (elem.tagName == 'img') {
            type = "image";
        }

        var crawled_url = elem.attribs.href || elem.attribs.src;
        if (typeof crawled_url == 'undefined' || !crawled_url || crawled_url.length == 0) {
            done();
            return;
        }

        // console.debug("Found link: ", crawled_url);
        var i;
        var file;
        var isFromSameDomain = true;

        if (crawled_url) {
            if (crawled_url.match(/\\{2}/g))
                file = self.create_dest_file(crawled_url, { ext: '.html', type: type, webroot: self.webroot });
        }
        else {
            done();
            return;
        }
        if (file) {
            var newUrl = file.parsedUrl;
            if (options.clone) {
                if (!options.domains) {
                    options.domains = [];
                    options.domains.push(originUrl.hostname);
                }
                var domains = options.domains;
                var exclude_it = true;
                for (i = 0; i < domains.length; ++i) {
                    var pattern = domains[i];
                    if (!newUrl.hostname.match(pattern)) {
                        continue;
                    } 
                    else {
                        exclude_it = false;
                        break;
                    }
                }
                if (exclude_it) {
                    for (i = 0; i < includes.length; ++i) {
                        var pattern = includes[i];
                        if (newUrl.hostname.match(pattern)) {
                            exclude_it = false;
                            isFromSameDomain = false;
                            break;
                        }
                    }
                }
                if (exclude_it) {
                    done();
                    return;
                }               
            }
            else {
                for (i = 0; i < excludes.length; ++i) {
                    var pattern = excludes[i];
                    if (newUrl.hostname.match(pattern)) {
                        done();
                        return;
                    }
                }
            }
        }
        if (!file) {
            if (crawled_url && crawled_url.length > 0) {
                if (crawled_url.charAt(0) == '/') {
                    if (result.origin) {
                        crawled_url = result.origin + crawled_url;
                    }
                    else {
                        crawled_url = result.protocol + "//" + result.host + crawled_url;
                    }
                }
                else if (crawled_url.match(/:\/\//g)) {
                    console.log("crawled_url: ", crawled_url);
                }
                else {
                    if (crawled_url.charAt(0) != '#')
                        crawled_url = result.baseurl + '/' + crawled_url;
                    else  {
                        done();
                        return;
                    }
                }
            }
            file = self.create_dest_file(crawled_url, { ext: '.html', type: type, webroot: self.webroot });
        }
        if (options.clone) {
            if (file) {  if (options.change_link || (file.type && (file.type == 'asset' || file.type == 'image'))) {
                var newLocalUrl;
                if (!isFromSameDomain)
                    newLocalUrl = path.join((options.webroot || "./"), file.parsedUrl.host, file.path, file.name);
                else
                    newLocalUrl = file.path + file.name;
                if (elem.attribs.href)
                    elem.attribs.href = newLocalUrl;
                else if (elem.attribs.src)
                    elem.attribs.src = newLocalUrl;}
            }
        }
        if (crawled_url)
            self.process_url(crawled_url, options, done);
        else
            done();
    }, 
    (err) => {
        if (err)
            console.error(err);
        resolve(options.clone ? $ : null);
    });
};

Crawler.prototype.process_result = async function (result, options, resolve) {
    const self = this;
    const href = result.href;
    const link = result.link; // new URL(result.href);
    if (!resolve && typeof options == 'function') {
        resolve = options;
        options = {};
    }
    try {
        const url = link.url;
        const html = result.html;
        if (href !== url) {
            const newlink = await self.redis_client.add_link(href);
            self.redis_client.update_link_redirect(newlink.key, url);
            self.redis_client.update_link_crawling_status(newlink.index, 1);
        }
        var file = self.create_dest_file(href, { ext: '.html', webroot: self.webroot });
        function callback($node) {
            if (file)
                fs.writeFileSync(file.file, $node ? $node.html() : html);
            resolve();
        }
        // check if the link is index page
        if (self.is_index_page(url)) {
            self.redis_client.update_link_crawling_status(link.index, 2);
            self.redis_client.update_link_index_status(link.index);
        }
        else {
            self.redis_client.update_link_crawling_status(link.index, 1);
        }
        if (typeof options.stop == 'undefined' || options.stop !== true) {
            self.process_html(html, result, options, callback);
        }
        else
            callback();
    }
    catch (err) {
        console.error(err);
        if (resolve && typeof resolve == 'function')
            resolve();
    }
};

Crawler.prototype.crawlSync = async function (link, options) {
    var tmp_processor = this.process_result;
    this.process_result = null;
    var result = await this.crawl(link, options);
    this.process_result = tmp_processor;
    return result;
};

Crawler.prototype.crawl = async function (link, options, errorCallback) {
    var self = this;
    self.crawl_options = options;
    options = options || {};

    var cookies;

    if (typeof link === 'string') {
        link = { url: link, parsedUrl: new URL(link) };
    }

    if (!link.parsedUrl) {
        try {
            link.parsedUrl = new URL(link.url);
        } catch (err) {
            console.error("Cannot handle this url: " + link.url);
            return;
        }
    }

    // if (options.clone && !self.seed.host) {
    //     self.seed.host = link.parsedUrl.host;
    //     self.seed.url = link.url;
    //     self.seed.pattern = options.domains || [];
    //     self.seed.level = options.level || 0;
    // }

    async function get_cookies() {
        var cookiesJar = await self.redis_client.get_cookies(link.parsedUrl.host);
        // cookieJar has been parsed and is an object
        return cookiesJar;
    }

    async function save_cookies() {
        const pageCookies = await self.page.cookies();
        if (pageCookies && Array.isArray(pageCookies) && pageCookies.length > 0) {
            console.log("Saving cookies for: " + link.parsedUrl.host, pageCookies);
            await self.redis_client.set_cookies(pageCookies, link.parsedUrl.host);
        }
    }

    async function set_page_cookies(cookies) {
        if (cookies && Array.isArray(cookies)) {
            // Ensure the cookies are in the correct format for Puppeteer
            const formattedCookies = cookies.map(cookie => {
                // Check if the cookie has a domain, if not, use the current host
                if (!cookie.domain) {
                    cookie.domain = link.parsedUrl.hostname;
                }
                // Check if the cookie has a path, if not, use "/"
                if (!cookie.path) {
                    cookie.path = "/";
                }
                return cookie;
            });
            
            try {
                await self.page.setCookie(...formattedCookies);
                console.log("Cookies set successfully for:", link.parsedUrl.host);
            } catch (error) {
                console.error("Error setting cookies:", error);
            }
        }
    }

    async function set_cookies() {
        cookies = await get_cookies();
    }

    if (this.options.level && (this.options.level - 0) == options.level && options.level > -1) {
        var fromLevels = self.get_levels(link.parsedUrl.pathname);
        if (!this.options.from_level)
            this.options.from_level = fromLevels;
        var levels = this.options.from_level || fromLevels;
        var level = levels - fromLevels;
        if (level < 0) {
            console.log('We are not crawling parent links as level is specified.');
            return;
        }
        else if (level > options.level) {
            console.log('We are not crawling links over the specified level.');
            return;
        }
    }
    var wait_time = options.wait_time;
    var browser_wait_time = options.browser_wait_time;
    var callback;
    if (options.processor) {
        callback = options.processor;
    }
    else {
        if (self.process_result)
            callback = self.process_result.bind(self);
    }
    if (self.index === -1 || !self.browser || !self.page) 
        await self.initialize();

    if (options.with_cookies) {
        if (!options.cookies)
            cookies = await get_cookies();
        else {
            cookies = options.cookies;
            delete options.cookies;
        }
    }

    return await new Promise((resolve, reject) => {
        (async () => {
            try {
                const url = link.url;
                var parsedUrl = null;
                try { parsedUrl = new URL(url); } catch (err) { console.error("Cannot handle this url: " + url); }
                var file;
                if (link.path && link.hash) {
                    file = link;
                }
                else {
                    file = self.create_dest_file(url, {ext: '.html', webroot: self.webroot});
                }
                function download_callback(err) {
                    if (err) 
                        self.redis_client.update_link_crawling_status(link.index, -99);
                    else
                        self.redis_client.update_link_crawling_status(link.index, 1);
                    resolve();                        
                }
                file.download_callback = download_callback;
                self.last_file = file;
                self.redis_client.update_link_crawling_status(link.index, 0);

                if (options.with_cookies) {
                    await set_page_cookies(cookies); 
                }

                // cannot set the local storage here, because the page is not loaded yet

                if (!self.with_browser || (file && file.binary)) {
                    var override = false;
                    if (typeof options.override == 'boolean')
                        override = options.override;
                    try {
                        var isFileExisting = fs.existsSync(file.file);
                        if (!isFileExisting || override) {
                            console.log('#' + link.index + " downloading file: " + url);
                            if (options.with_curl) {
                                self.curl(file, download_callback); 
                            }
                            else
                                self.download(file, download_callback);
                        }
                        else {
                            self.redis_client.update_link_crawling_status(link.index, 99);
                            resolve();
                        }
                    }
                    catch (err) {
                        self.redis_client.update_link_crawling_status(link.index, 1);
                        console.error(err);
                        resolve(err);
                    }
                }
                else {
                    try {
                        await self.page.goto(url, { waitUntil: 'networkidle2', timeout: browser_wait_time || self.opts.browser.waitTimeout || 30000 });

                        if (options.local_storage) {
                            try {
                                await self.page.evaluate((data) => {
                                    Object.entries(data).forEach(([key, value]) => {
                                        console.debug("Setting local storage: ", key, value);
                                        localStorage.setItem(key, value);
                                    });
                                }, options.local_storage);
                            }
                            catch (err) {
                                console.error("Error setting local storage: ", err);
                            }
                            // this is for the first time
                            delete options.local_storage;
                        }

                        let has_page_been_evaluated = false;

                        const evaluate_page = () => {
                            return {
                                href: location.href,
                                origin: location.origin,
                                baseurl: document.baseURI,
                                html: document.documentElement.innerHTML,
                                host: location.host,
                                protocol: location.protocol,
                            };
                        }

                        const process_page = async (evaluated_result, callback, options, resolve) => {
                            let result = null;
                            if (!evaluated_result) {
                                console.warn("Page evaluation failed.");
                                return false;
                            }

                            if (callback) {
                                result = await callback(evaluated_result, options, resolve);
                            }
                            else {
                                result = await self.process_result(evaluated_result, options, resolve);
                            }

                            if (typeof result === 'object') {
                                if (result.download && result.download.length > 0) {
                                    for (const download of result.download) {
                                        await self.download(download);
                                        // wait for the download to finish
                                        await setTimeout(2000);
                                    }
                                }
                            }
                            return result;
                        }

                        let evaluated_result = null;
                        const perform_action = async (action) => {
                            console.debug("Performing action: ", action);
                            try {
                                if (action.on === false) {
                                    console.warn("Action is not on: ", action);
                                    return;
                                }

                                if (action.action === 'click') {
                                    if (action.text) {
                                        // Use page.evaluate to find the element with the specified text
                                        // const element = await self.page.evaluate((selector, value) => {
                                        //     const elements = document.querySelectorAll(selector);
                                        //     console.debug("Checking elements if they contain the text: ", value);
                                        //     for (const el of elements) {
                                        //         // get the element text
                                        //         let text = el.textContent.trim();
                                        //         console.log("Element text: ", text);
                                        //         if (text == value || text.includes(value)) {
                                        //             console.debug("Found element with text: ", text);
                                        //             return el; // Return the element if it contains the text
                                        //         }
                                        //     }
                                        //     return null; // Return null if no element is found
                                        // }, action.selector, action.text); // Pass the selector and text to check

                                        // if (element) {
                                        //     await Promise.all([
                                        //         element.click(), // Click the element found by page.evaluate
                                        //         self.page.waitForNavigation({ waitUntil: 'networkidle2' }),
                                        //         save_cookies(),
                                        //     ]);
                                        // } else {
                                        //     console.warn(`Element not found with selector '${action.selector}' and text '${action.text}'`);
                                        //     return false; // Return false to indicate failure
                                        // }
                                        const clicked = await self.page.evaluate((selector, value) => {
                                            const elements = document.querySelectorAll(selector);
                                            console.debug("Checking elements if they contain the text: ", value);
                                            for (const el of elements) {
                                                let text = el.textContent.trim();
                                                console.log("Element text: ", text);
                                                if (text == value || text.includes(value)) {
                                                    console.debug("Found element with text: ", text);
                                                    el.click(); // Perform the click action
                                                    return true; // Indicate success
                                                }
                                            }
                                            return false; // Indicate failure
                                        }, action.selector, action.text);
                                        
                                        if (!clicked) {
                                            console.warn(`Element not found with selector '${action.selector}' and text '${action.text}'`);
                                        }
                                        /**
                                         * there are two other options to do these
                                         */
                                        // Method #2
                                        // const elementIndex = await self.page.evaluate((selector, value) => {
                                        //     const elements = document.querySelectorAll(selector);
                                        //     console.debug("Checking elements if they contain the text: ", value);
                                        //     for (let i = 0; i < elements.length; i++) {
                                        //         let text = elements[i].textContent.trim();
                                        //         console.log("Element text: ", text);
                                        //         if (text == value || text.includes(value)) {
                                        //             console.debug("Found element with text: ", text);
                                        //             return i; // Return the index of the element
                                        //         }
                                        //     }
                                        //     return -1; // Return -1 if no element is found
                                        // }, action.selector, action.text);
                                        
                                        // if (elementIndex !== -1) {
                                        //     const elements = await self.page.$$(action.selector);
                                        //     await elements[elementIndex].click(); // Click the element using its index
                                        // } else {
                                        //     console.warn(`Element not found with selector '${action.selector}' and text '${action.text}'`);
                                        // }
                                        // Method #3
                                        // const elements = await self.page.$$(action.selector);
                                        // let found = false;

                                        // for (const el of elements) {
                                        //     const text = await self.page.evaluate(el => el.textContent.trim(), el);
                                        //     console.log("Element text: ", text);
                                        //     if (text == action.text || text.includes(action.text)) {
                                        //         console.debug("Found element with text: ", text);
                                        //         await el.click(); // Click the element
                                        //         found = true;
                                        //         break;
                                        //     }
                                        // }

                                        // if (!found) {
                                        //     console.warn(`Element not found with selector '${action.selector}' and text '${action.text}'`);
                                        // }
                                    }
                                    else
                                        await Promise.all([
                                            self.page.click(action.selector),
                                            self.page.waitForNavigation({ waitUntil: 'networkidle2' }),
                                            // save_cookies(),
                                        ]);
                                } 
                                else if (action.action === 'type') {
                                    await Promise.all([
                                        // self.page.click(action.selector),
                                        // self.page.keyboard.type(action.value),
                                        await self.page.$eval(action.selector, el => el.value = ''),
                                        // self.page.waitForTimeout(100),
                                        self.page.focus(action.selector),
                                        // self.page.waitForTimeout(100),
                                        await self.page.type(action.selector, action.value)
                                    ]);
                                }
                                else if (action.action === 'wait') {
                                    if (typeof action.time === 'number') {
                                        await setTimeout(action.time);
                                    } 
                                    else if (action.selector) {
                                        // Use page.evaluate to find the element with the specified text
                                        if (action.text) {
                                            const element = await self.page.evaluate((selector, text) => {
                                                const elements = document.querySelectorAll(selector);
                                                for (const el of elements) {
                                                    if (el.textContent.includes(text)) {
                                                        return el; // Return the element if it contains the text
                                                    }
                                                }
                                                return null; // Return null if no element is found
                                            }, action.selector, action.text); // Pass the selector and text to check

                                            if (element) {
                                                // await self.page.waitForSelector(action.selector); // we don't need to wait for the selector, we already found it
                                            } else {
                                                console.warn(`Element not found with selector '${action.selector}' and text '${action.text}'`);
                                                return false; // Return false to indicate failure
                                            }
                                        }
                                        else
                                            await self.page.waitForSelector(action.selector);
                                    }
                                }
                                else if (action.action === 'screenshot') {
                                    await self.page.screenshot({ path: action.path || 'screenshot.png' });
                                }
                                else if (action.action === 'evaluate') {
                                    evaluated_result = await self.page.evaluate(evaluate_page);
                                    has_page_been_evaluated = true;
                                    return evaluated_result;
                                }
                                else if (action.action === 'process') {
                                    return await process_page(evaluated_result, callback, options, resolve);
                                }
                                else if (action.action === 'setCookie') {
                                    // Ensure the cookie has a domain, if not, use the current host
                                    if (!job.cookie.domain) {
                                        job.cookie.domain = link.parsedUrl.hostname;
                                    }
                                    // Ensure the cookie has a path, if not, use "/"
                                    if (!job.cookie.path) {
                                        job.cookie.path = "/";
                                    }
                                    await self.page.setCookie(job.cookie);
                                }
                                else if (action.action === 'saveCookies') {
                                    await save_cookies();
                                }
                                else if (action.action === 'goto') {
                                    await Promise.all([
                                        get_cookies(),
                                        set_page_cookies(cookies),
                                        self.page.goto(action.url, { waitUntil: 'networkidle2' })
                                    ]);
                                }
                                else if (action.reload) {
                                    await self.page.reload({ waitUntil: 'networkidle2' });
                                }
                                else if (action.action === 'hold') {
                                    console.log("Holding it:", action);
                                }
                                else if (action.action === 'download') {
                                    if (action.url) {
                                        const downloadLink = self.create_dest_file(action.url, { ext: '.html', webroot: self.webroot });
                                        await self.download(downloadLink, action.callback);
                                    } 
                                    else {
                                        console.warn("Download action missing URL: ", action);
                                    }
                                }
                                else if (action.action === 'eval') {
                                    await self.page.$eval(action.selector, (el, value) => {
                                        el.value = value;
                                      }, action.value);
                                }
                                else if (action.action === 'scroll') {
                                    // scroll to the bottom of the page
                                    await self.page.evaluate((value) => {
                                        window.scrollTo(0, value || document.body.scrollHeight);
                                    }, action.value);
                                    // wait for the page to load
                                    await setTimeout(1000);
                                }
                                else if (action.action === 'pull') {
                                    if (action.selector && action.value) {
                                        console.log(`Pulling element: ${action.selector} with value: ${action.value}`);
                                        await self.page.evaluate((selector, value) => {
                                            const element = document.querySelector(selector);
                                            if (element) {
                                                element.scrollTop = value; // Simulate pulling by setting scroll position
                                            }
                                        }, action.selector, action.value);
                                    } else {
                                        console.warn("Pull action requires both 'selector' and 'value'.");
                                    }
                                }
                                else if (action.action === 'reload') {
                                    await self.page.reload({ waitUntil: 'networkidle2' });
                                    
                                }
                                else if (action.action === 'iframe') {
                                    const frameHandle = await self.page.$(action.selector || 'iframe');         
                                    if (!frameHandle) {
                                        console.error(`Iframe not found: ${iframeSelector}`);
                                        return null;
                                    }
                                    const frame = await frameHandle.contentFrame();
                            
                                    // 2. Get the iframe's HTML content
                                    evaluated_result = await frame.evaluate(evaluate_page); 
                                    has_page_been_evaluated = true;                        
                                }
                                else if (action.action === 'close') {
                                    await self.page.close();
                                    return false;
                                }
                                else if (action.action === 'exit') {
                                    await self.browser.close();
                                    process.exit(0);
                                }
                                else if (action.action === 'setLocalStorage') {
                                    await self.page.evaluate((key, value) => {
                                        localStorage.setItem(key, value);
                                    }, action.key, action.value);
                                }
                                else if (action.action === 'setSessionStorage') {
                                    await self.page.evaluate((key, value) => {
                                        sessionStorage.setItem(key, value);
                                    }, action.key, action.value);
                                }
                                else {
                                    console.warn("Unknown action: ", action);
                                    return false;
                                }
                            }
                            catch (err) {
                                console.error("Error performing action: ", action, err);
                                return false;
                            }
                            return true;
                        }

                        if (options.inject_jquery) {
                            await self.page.addScriptTag({ path: path.resolve(__dirname, './jquery-3.5.1.min.js') });
                        }
                        if (options.injects && Array.isArray(options.injects)) {
                            for (const js of options.injects) {
                                await self.page.addScriptTag({ path: js });
                            }
                        }
                        if (parsedUrl && parsedUrl.pathname === '/' && options.screenshot) {
                            var screenshotFile = path.resolve(file.dir, './screenshot.png');
                            await self.page.waitForTimeout(1000);
                            await self.page.screenshot({ path: screenshotFile });
                        }
                        if (options.wait_for) {
                            if (typeof options.wait_for === 'number')
                                await self.page.waitForTimeout(options.wait_for);
                            else
                                await self.page.waitForSelector(options.wait_for);
                        }
                        // page.waitForTimeout(n) function does not work in puppeteer
                        // if (wait_time) {
                        //     await self.page.waitForTimeout(wait_time);
                        // }
                        if (options.type) {
                            await self.page.type(options.type.selector, options.type.text);
                        }
                        if (options.click) {
                            await self.page.click(options.click);
                        }

                        if (options.actions) {
                            for (const job of options.actions) {
                                if (job.if) {
                                    const condition = await self.page.evaluate((selector) => {
                                        return !!document.querySelector(selector);
                                    }, job.if);
                                    if (condition) {
                                        for (const action of job.then) {
                                            await perform_action(action);
                                        }
                                    }
                                }
                                else if (job.repeat) {
                                    let failed_limit = job.failed_limit || 1;
                                    let failed_count = 0;
                                    let scroll_height = 0; // get current window height
                                    scroll_height = await self.page.evaluate(() => {
                                        return window.innerHeight;
                                    });
                                    while (true) {
                                        let result = null;
                                        for (const action of job.repeat) {
                                            if (action.action === 'process') {
                                                result = await process_page(evaluated_result, callback, options);

                                                if (typeof result === 'object' && result.failed === true) {
                                                    failed_count++;
                                                    console.warn("Data process returned false: " +  failed_count);
                                                }
                                                else {
                                                    // reset the failed count
                                                    failed_count = 0;
                                                }
                                            }
                                            else {
                                                if (action.action === 'scroll') {
                                                    scroll_height += action.value || 100;
                                                    action.value = scroll_height;
                                                }
                                                result = await perform_action(action);
                                            }

                                            if (action.action === 'evaluate') {
                                                evaluated_result = result;
                                                has_page_been_evaluated = true;
                                            }
                                        }
                                        
                                        if (job.until) {
                                            const condition = await self.page.evaluate((selector) => {
                                                return !!document.querySelector(selector);
                                            }, job.until);
                                            if (condition) {
                                                break;
                                            }
                                        }
                                        else {
                                            if (failed_count >= failed_limit) {
                                                console.warn("Failed limit reached: " + failed_count);
                                                break;
                                            }
                                        }
                                    }
                                }
                                else if (job.action) {
                                    await perform_action(job);
                                }
                                else {
                                    console.warn("Invalid action: ", job);
                                }
                            }
                            // Remove the actions after processing
                            // delete options.actions;
                        }

                        // so we have to wait for whatever is going on before then we save the cookies
                        if (options.with_cookies) {
                            await save_cookies(); delete options.with_cookies; // we don't need to set it again
                        }

                        if (!options.viewonly) {
                            if (!has_page_been_evaluated) {
                                let result = await self.page.evaluate(
                                    evaluate_page
                                    //     () => {
                                    //     return {
                                    //         href: location.href,
                                    //         origin: location.origin,
                                    //         baseurl: document.baseURI,
                                    //         html: document.documentElement.innerHTML,
                                    //         host: location.host,
                                    //         protocol: location.protocol,
                                    //     };
                                    // }
                                );
                                
                                result.link = link;
                                if (!result.baseurl)
                                    result.baseurl = result.origin;
                                else 
                                    result.baseurl = result.baseurl.slice(0, result.baseurl.lastIndexOf('/'));
                                process_page(result, callback, options, resolve);
                             }
                            else {
                                console.log("Page has been evaluated, skipping...");
                                resolve(null, options);
                            }
                        }
                        else {
                            // if we proceed to crawling, it won't be viewonly anymore
                            console.log("View only mode, skipping...");
                            options.viewonly = false;
                            resolve(null, options);
                        }
                    } catch (err) {
                        if (err)
                            console.error(err);
                        if (errorCallback)
                            errorCallback();
                        resolve(err);
                    }
                }
            }
            catch (err) {
                if (err)
                    console.error(err);
                if (errorCallback)
                    errorCallback();
                resolve(err);
            }
        })();
    });
};

Crawler.prototype.crawl_next = async function (crawl_options) {
    var self = this;
    var link = null;
    var count = await self.redis_client.get_links_count();
    var lastSkip = -1;
    var lastHost = null;
    var lastHostCount = 0;
    self.idle = 0;
    while (true) {
        try {
            while (self.index < count) {
                if (self.index == 1654)
                    console.log("debugging");
                link = await self.redis_client.get_allowed_link_in_seeds(self.index);
                const parsedUrl = link.parsedUrl = new URL(link.url);
                if (crawl_options.clone || parsedUrl.hostname !== lastHost || (parsedUrl.hostname === lastHost && lastHostCount < 6)) {
                    if (parsedUrl.hostname === lastHost)
                        ++lastHostCount;
                    else {
                        lastHostCount = 0;
                        lastHost = parsedUrl.hostname;
                    }
                    console.log('#' + link.index + ", crawling " + link.url + ", index: " + link.index);

                    if (crawl_options.clone) {
                        // hold the horse, and wait for a bit if we are crawling the same domain
                        if (lastHostCount > 6) {
                            console.log("Waiting for a bit...");
                            await utils.sleep(crawl_options.wait_time || 1000);
                        }
                    }
                    await self.crawl(link, crawl_options);
                }
                else {
                    console.error("skipping this for now: " + link.url);
                    if (lastSkip === -1)
                        lastSkip = link.index;
                }
                self.index = link.index + 1;
            }
            count = await self.redis_client.get_links_count();
            if (self.index >= count)
                break;
        } 
        catch (err) {
            if (err && err.message && err.message === 'end of queue') {
                self.index = count;
                if (self.idle) {
                    if (lastSkip >= (count - 1)) {
                        console.log("Reach the end of queue, exiting...");
                        process.exit(0);
                    }
                    else {
                        self.index = lastSkip;
                        eventEmitter.emit('crawl');
                    }
                }
            }
            else
                console.error(err);
            break;
        }
    }
    console.log("Crawler idle");
    self.idle = 1;
    if (lastSkip > -1 && lastSkip < count) {
        self.index = lastSkip;
        self.eventEmitter.emit('crawl');
    }
};

Crawler.prototype.start = function (crawl_options) {
    var self = this;
    self.initialize();
    self.eventEmitter.addListener('crawl', () => {
        self.crawl_next(crawl_options);
    });
    process.on('uncaughtException', function (err) {
        console.log('Caught exception: ' + err);
        console.log(err.stack);
        self.signal_crawl();
    });
    self.signal_crawl();
};

Crawler.prototype.signal_crawl = function () {
    this.eventEmitter.emit('crawl');
}

module.exports = Crawler;
