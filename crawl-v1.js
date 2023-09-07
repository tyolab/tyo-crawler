const path = require('path');

const async = require('async');

var Params = require('node-programmer/params');
const { electron } = require('process');

var Crawler = require('../lib/crawler');

var params = new Params({
  "click": null,
  "show-window": false,
  "with-nightmare": true,          // if the default is not nightware, we can just down it with curl, wget
  "next-crawl-wait-time": 31,
  level: -1,
  "pattern": null,
  "han": false,
  "co": [],                       // options for the crawler
  "output": null,
  "dbhost": 'localhost',
  "dbport": 6379,
  "with-cookies": false
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

var firstUrl = new URL(inputs[0]);

// --hsn, host as namespace
var namespace = opts["han"] ? firstUrl.hostname : 'tmp'; // if not, just use default namespace which should be "tmp"
opts.redis = opts.redis || {};
opts.redis.namespace = namespace;
opts.redis.separator = ":";
/// temporary link key prefix
opts.redis.link_key_prefix = namespace + ":l:";

const wwwPath = opts["webroot"]; // || path.resolve(__dirname, "../www/");
opts.webroot = wwwPath;

var crawler = new Crawler(opts);
crawler.options = {level: opts.level, local_path: opts.local_path};

var crawl_option = {};
crawl_option.click = opts["click"];
crawl_option.with_cookies = opts["with-cookies"];

console.log("We are using redis server for link caching: " + opts.dbhost);
crawler.redis_client.connect({host: opts.dbhost, port: opts.port});

if (opts.seed === true) {

    var seeds = inputs;
    if (seeds && typeof seeds === 'string')
        seeds = [seeds];

    var pattern = [];

    if (opts.pattern) {
        if (typeof opts.pattern === 'string')
            pattern.push(opts.pattern);
        else if (Array.isArray(opts.pattern))
            pattern = opts.pattern;
    }

    seeds.map((url, index) => {
        var newUrl = new URL(url);

        // strictly only the 
        pattern.push(newUrl.host + (newUrl.pathname || ""));
    });

    var match = function(url) {
        for (var i = 0; i < pattern.length; ++i) {
            var newUrl = new URL(url);
            var newStr = newUrl.host + (newUrl.pathname || "");
            if (newStr.match(pattern[i])) {
                return true;
            }
        }
        return false;
    }

    var main = async function () {

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

        async.eachSeries(seeds, (url, done) => {
            var fileObj = crawler.create_dest_file(url);

            crawler.redis_client.add_link(url, function() {
                // by default we only allow the links that matching the seeds
                // if the links are redirected, they are not allowed
                crawler.redis_client.add_allowed_host(fileObj.parsedUrl.hostname, fileObj.path);
                done();
            });

        }, ()=> {
            crawler.start();
        })
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

        main();
    }
}
else {
    if (inputs.length > 1) {
        console.error("Too many inputs");
        process.exit(-1);
    }

    // if (!options.output) {
    //     console.error("need to ");
    //     process.exit(-1);
    // }

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
        console.log("Saving the file to " + opts.output);

        crawler.crawl(inputs[0], crawl_option).then(
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
                else
                    exit_crawl(-1);
            }
        );
    }

    crawl();
}