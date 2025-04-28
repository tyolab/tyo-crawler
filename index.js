const path = require('path');

const async = require('async');
const fs = require('fs');

var Params = require('node-programmer/params');

var Crawler = require('./lib/crawler');

// import path from 'path';
// import async from 'async';
// import fs from 'fs';
// import { URL } from 'url';

// import * as Params from 'node-programmer/params';
// import Crawler from './lib/crawler.js';
// import XProcessor from './processors/x.js';

var params = new Params({
  "click": null,
  "show-window": false,
  "with-browser": true,          // if the default is not nightware, we can just down it with curl, wget
  "next-crawl-wait-time": 31,
  level: -1,
  "pattern": null,
  "han": false,
  "co": [],                       // options for the crawler
  "output": null,
  "dbhost": 'localhost',
  "dbport": 6379,
  "with-cookies": false,
  "webroot": './www',
  "clone": false,
  "clone-path": null,                 // url path if it is for clone, only urls that match this path will be downloaded
  "exclude": [],
  "include": [],
  "with-curl": false,
  "viewonly": false,
  "seed": false,
  "local-storage": null,
  "actions-file": null,
  "wait-time": 1200,                 // default wait time for next crawl, 1 millisecond
  "browser-wait-time": 0,            // default wait time for the browser 
  "processor": null,        
  "links-file": null,
  "cookies-file": null,
});

var opts = params.getOpts();
var optCount = params.getOptCount();

var inputs =  opts["---"];
if (!Array.isArray(inputs))
    inputs = [inputs];

if (optCount <= 0 || !inputs || inputs.length === 0) {
    console.error("Usage: node " + " " + __filename + " [options] url(s)");
    process.exit(-1);
}

var firstUrl = null;
var namespace = null;

const wwwPath = opts["webroot"]; // || path.resolve(__dirname, "../www/");
opts.webroot = wwwPath;

var local_storage_data = null;
function read_local_storage() {
    var local_storage = opts["local-storage"];
    if (local_storage) {
        try {
            var data = require(local_storage);
            if (data) {
               local_storage_data = data;
            }
        }
        catch (err) {
            console.error("Error reading local storage file: " + err);
        }
    }
}

read_local_storage();

function read_actions_file() {
    var actions_file = opts["actions-file"];
    if (actions_file) {
        try {
            var data = require(actions_file);
            if (data) {
                opts.actions = data;
            }
        }
        catch (err) {
            console.error("Error reading actions file: " + err);
        }
    }
}
read_actions_file();

let processor_func = null;
function load_processor() {
    var processor = opts["processor"];
    if (processor) {
        try {
            var processor_path = null;

            if (!processor.startsWith(path.sep)) {
                processor_path = './processors' + path.sep + processor;
            }
            else {
                processor_path = processor;

                if (!processor_path.endsWith('.js')) {
                    processor_path += '.js';
                }
                processor_path = path.resolve(processor_path);
        
                if (!fs.existsSync(processor_path)) {
                    console.error("Processor file not found: " + processor_path);
                    return;
                }
            }

            try {
                var Processor = require(processor_path);
                if (Processor) {
                    let processor_instance = new Processor();
                    processor_func = function (result, options, resolve, reject) {
                        return processor_instance.process_html(result, options, resolve, reject);
                    }
                    console.debug("Using processor: " + processor);
                }
            }
            catch (err) {
                console.error("Error loading processor: " + err);
                process.exit(-1);
            }
        }
        catch (err) {
            console.error("Error loading processor: " + err);
        }
    }
}
load_processor();

let links = null
function load_links_file() {
    var links_file = opts["links-file"];
    if (links_file) {
        try {
            var data = fs.readFileSync(links_file, 'utf8');
            if (data) {
                links = data.split('\n');
            }
        }
        catch (err) {
            console.error("Error reading links file: " + err);
        }
    }
}
load_links_file();

let cookies = null;
function read_cookies_file() {
    var cookie_file = opts["cookies-file"];
    if (cookie_file) {
        try {
            var data = fs.readFileSync(cookie_file, 'utf8');
            // assume the cookie file is in JSON format
            if (data) {
                cookies = JSON.parse(data);
            }
        }
        catch (err) {
            console.error("Error reading cookie file: " + err);
        }
    }
}
read_cookies_file();

let url = inputs.length > 0 ? inputs[0] : (links && links.length > 0 ? links[0] : null);
firstUrl = url ? new URL(url) : null;

// --hsn, host as namespace
namespace = (opts["han"] && firstUrl) ? firstUrl.hostname : 'tmp'; // if not, just use default namespace which should be "tmp"
opts.redis = opts.redis || {};
opts.redis.namespace = namespace;
opts.redis.separator = ":";
/// temporary link key prefix
opts.redis.link_key_prefix = namespace + ":l:";

var crawler = new Crawler(opts);
crawler.options = {level: opts.level, local_path: opts.local_path};

var crawl_options = {};
crawl_options.click = opts["click"];
crawl_options.with_cookies = opts["with-cookies"];
crawl_options.clone = opts["clone"];
crawl_options.excludes = opts["exclude"];
crawl_options.includes = opts["include"];
crawl_options.with_curl = opts["with-curl"]; // for download
crawl_options.viewonly = opts["viewonly"];
crawl_options.show_window = opts["show-window"];
crawl_options.with_browser = opts["with-browser"];
crawl_options.next_crawl_wait_time = opts["next-crawl-wait-time"];
crawl_options.local_storage = local_storage_data;
crawl_options.actions = opts.actions;
crawl_options.wait_time = opts["wait-time"];
crawl_options.browser_wait_time = opts["browser-wait-time"];
crawl_options.processor = processor_func;
crawl_options.cookies = cookies;

async function connect_database() {
    console.log("We are using redis server for link caching: " + opts.dbhost);
    await crawler.redis_client.connect({host: opts.dbhost, port: opts.port});
}

async function main() {

    await connect_database();

    if (opts.clone)
        opts.seed = true;

    if (links && links.length > 0) 
        opts.seed = true;

    if (opts.seed === true) {

        var seeds = inputs;
        if (seeds && typeof seeds === 'string')
            seeds = [seeds];

        if (links && links.length > 0) {
            seeds = seeds.concat(links);
        }

        // filter out the empty urls
        seeds = seeds.filter((url) => {
            if (url && url.length > 0) {
                try {
                    new URL(url);
                    return true;
                }
                catch (err) {
                    console.error("Invalid url: " + url);
                    return false;
                }
            }
            return false;
        }
        );
        // remove duplicates
        seeds = [...new Set(seeds)];

        var pattern = [];

        if (opts.pattern) {
            if (typeof opts.pattern === 'string')
                pattern.push(opts.pattern);
            else if (Array.isArray(opts.pattern))
                pattern = opts.pattern;
        }

        seeds.map((url, index) => {
            if (!url)
                return;

            var newUrl = new URL(url);

            // strictly only the host but not the path
            var match_with = newUrl.host;

            if (opts.clone_path && opts.clone_path.length > 0) {
                if (opts.clone) {
                    match_with += (opts.clone_path[0] == '/' ? opts.clone_path : '/' + opts.clone_path);
                }
                else {
                    console.warn("Clone path is set, but crawler is not set to clone mode, so the clone path will be ignored: " + opts.clone_path);
                }
            }
            // check if the match_with already in the pattern
            if (pattern && pattern.length > 0) {
                for (var i = 0; i < pattern.length; ++i) {
                    if (pattern[i] === match_with) {
                        // console.warn("The url pattern already exists: " + match_with);
                        return;
                    }
                }
            }
            pattern.push(match_with);
            console.log("Crawl url pattern: " + pattern + "*");
        });

        var match = function(url) {
            // this can be used for further link matching
            // for the domain wise links downloading has been done

            if (pattern && pattern.length > 0) {
                for (var i = 0; i < pattern.length; ++i) {
                    var newUrl = new URL(url);
                    var newStr = newUrl.host + (newUrl.pathname || "");
                    if (newStr.match(pattern[i])) {
                        return true;
                    }
                }
                return false;
            }

            return true;
        }

        var func = async function () {

            var index = 0;
            var is_link_allowed = crawler.redis_client.is_link_allowed;
            
            crawler.redis_client.is_link_allowed = function(url) {
                if (!url)
                    return false;

                return match(url);
                //var fileObj = crawler.create_dest_file(url);

                // we need to match the host and path
                //return is_link_allowed.call(crawler.redis_client, fileObj);
            }
            crawl_options.domains = [];

            async.eachSeries(seeds, 
                (url, done) => {
                    try {
                        var fileObj = crawler.create_dest_file(url);
                        if (!fileObj) {
                            throw new Error("Unrecognised url: " + url);
                        }
                        crawl_options.domains.push(fileObj.parsedUrl.hostname);
                        crawler.redis_client.add_link(url, function() {
                            // by default we only allow the links that matching the seeds
                            // if the links are redirected, they are not allowed
                            crawler.redis_client.add_allowed_host(fileObj.parsedUrl.hostname, fileObj.path);
                            done();
                            },
                            {
                                force: true,
                            }
                        );
                    }
                    catch (err) {
                        console.error("Error creating destination file for url: " + url);
                        console.error(err);
                        done(err);
                    }
                }, 
                ()=> {
                    crawler.start(crawl_options);
                }
            )
        }

        if (!seeds || !seeds.length) {
            console.error("Usage: node " + process.argv[1] + " seed_url seed_url ...");
            process.exit(-1);
        }
        else {
            // Date.prototype.yyyymmdd = function() {
            //     var mm = this.getMonth() + 1; // getMonth() is zero-based
            //     var dd = this.getDate();
            
            //     return [this.getFullYear(),
            //             (mm>9 ? '' : '0') + mm,
            //             (dd>9 ? '' : '0') + dd
            //            ].join('');
            //   };
            
            //   var date = new Date();

            func();
        }
    }
    else {
        if (!inputs || inputs.length === 0) {
            console.error("Usage: node " + process.argv[1] + " url");
            process.exit(-1);
        }

        var old_create_file_func = crawler.create_dest_file.bind(crawler);
        crawler.local_path = './';

        const exit_crawl = (code) => {
            if (crawler.nm_instance)
                crawler.nm_instance.end();
            process.exit(code);
        }

        const download_callback = () => {
            console.debug("download finished.");
            exit_crawl(1);
        }

        var nm = null;

        var exit_func = function () {
            console.debug("crawling finished.");
            exit_crawl(0);
        }

        crawler.create_dest_file = function (url, func_opts) {
            var file = old_create_file_func(url, func_opts);

            if (func_opts && func_opts.from) {
                exit_func = null;

                if (!nm)
                    nm = func_opts.by;

                if (opts.output && opts.output.length > 0) {
                    file.file = opts.output;
                }

                file.callback = download_callback;
            }

            return file;
        }

        async function crawl() {
            console.log("Crawling " + inputs[0] + "...");
            if (opts.output)
                console.log("Saving the file to " + opts.output);

            crawler.crawl(inputs[0], crawl_options).then(
                ()=> {
                // 
                    setTimeout(()=> {
                        // we will wait for a bit
                        if (!exit_func && typeof exit_func == 'function')
                            exit_func();
                    }, 8000);
                }
            ).catch(
                (err) => {
                    // Error: navigation error
                    // we can ignore this error as it could just 
                    if (err && err.message && err.message == 'navigation error') {
                        // igore it
                    }
                    else {
                        console.error(err);
                        exit_crawl(-1);
                    }
                }
            );
        }

        crawl();
    }
}

main().then(
    ()=> {
        console.debug("Crawling finished.");
        //exit_crawl(0);
    }
).catch(
    (err) => {
        console.error(err);
        exit_crawl(-1);
    }
);