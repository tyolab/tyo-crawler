const asx = require('./asx');
const async = require('async');

const Nightmare = require('nightmare');
require('nightmare-download-manager')(Nightmare);

const cheerio = require('cheerio');
const crypto = require('crypto');
const {
    resolve
} = require('path');

var http = require('http');
var https = require('https');
const fs = require('fs');
const path = require('path');

// Import events module
var events = require('events');

var Params = require('node-programmer/params');
const { electron } = require('process');

var params = new Params({
  "show-electron": false,
  "with-nightmare": false,
  ms: 31
});

var opts = params.getOpts();
var optCount = params.getOptCount();

var useNightmare = opts["with-nightmare"];
var showElectron = opts["show-electron"];

// Nightmare
const nightmare = Nightmare({
    frame: true,
    maxHeight:16384,
    maxWidth:16384,        
    width: 1200,
    height: 1024, 
    show: showElectron,
    waitTimeout: 6000,
    webPreferences: {
        devTools: true,
        // preload: 'alertMessage.js',
        // nodeIntegration: false,
        webSecurity: false,
        allowRunningInsecureContent: true
      }
});

var seeds = opts["---"];

// Create an eventEmitter object
var eventEmitter = new events.EventEmitter();

var idle = 1;

const wwwPath = opts["webroot"] ? opts["webroot"] : path.resolve(__dirname, "../www/");

nightmare.on('download', function(state, downloadItem){
    console.log("Download item: " + JSON.stringify(downloadItem));
    if(state == 'started'){
        var file = create_dest_file(downloadItem.url);
        nightmare.emit('download', path.resolve(file.dir, downloadItem.filename), downloadItem);
    }
  });

var download = async function(link, cb) {
    // const parseUrl = new URL(linkurl);

    var file = fs.createWriteStream(link.file);
    var web;
    if (link.parsedUrl.protocol === 'https:')
        web = https;
    else
        web = http;

    web.get(link.url, function(response) {

        if (!link.binary) {
            /* */
            console.log("checking response...");
        }

      response.pipe(link.file);

      file.on('finish', function() {
        file.close(cb);
      });
    });
  }

async function process_url(crawled_url, result, resolve) {
    var originUrl =null, normalisedUrl, newUrl;
    try {
        try { originUrl = new URL(result.baseurl);} catch(err) {originUrl = new URL(result.protocol + result.host)};

        if (crawled_url.endsWith('contact-us'))
            console.log('got you');
        newUrl = null;
        
        try {
            newUrl = new URL(crawled_url);
        }
        catch(err) {
            var tempstr;
            if (crawled_url.charAt(0) === '/') {
                // if (crawled_url.length === 1)
                //     // for avoiding the error getting the substring of the link
                //     crawled_url += '#';

                if (result.origin) {
                    tempstr = result.origin + crawled_url;
                }
                else {
                    tempstr = originUrl.toString() + crawled_url.substr(1);
                }
            }
            else {
                tempstr = (result.baseurl + crawled_url);
            }

            newUrl = new URL(tempstr);           
        }
        normalisedUrl = newUrl.toString();

        if (normalisedUrl && normalisedUrl.length) {
            //if (!links.has(pathUrl)) {
            await add_link(normalisedUrl);
            // links.add(normalisedUrl);
        }
    } catch (err) {
        console.error('invalid link: ' + JSON.stringify(err));
    }
    resolve();
}

async function add_link(url) {
    var link = null; 
    try {
        link =  await asx.add_link(url);
    }
    catch (err) {
        console.error(err);
    } 
    return link;
}

const pattern1 = /^(.*\.(htm|html|pdf|txt|xlsx|xls|ppt|pptx|doc|docx))$/i;
const pattern2 = /^(.*\.(pdf|txt|xlsx|xls|ppt|pptx|doc|docx))$/i;

function create_dest_file(url) {

    const parsedUrl = new URL(url);
    const localArchivePath = path.resolve(wwwPath, parsedUrl.host);
    var htmlFile;
    var lastChar = null;
    var parentDir;
    var matchedPattern2 = false;
    var destFile;
    try {
        lastChar = parsedUrl.pathname[parsedUrl.pathname.length - 1];
    } catch (err) {}

    if (lastChar && lastChar === '/') {
        htmlFile = 'index.html';
        parentDir = parsedUrl.pathname;
    } 
    else {
        var lastSegment = path.basename(parsedUrl.pathname);
        parentDir = parsedUrl.pathname.substr(0, parsedUrl.pathname.length - lastSegment.length);
        if (lastSegment.match(pattern1)) {
            if (lastSegment.match(pattern2))
                matchedPattern2 = true;

            htmlFile = lastSegment;
        }
        else
            htmlFile = lastSegment + ".html";
    }

    var destParent = path.resolve(localArchivePath, './' + parentDir);
    try {
        if (!fs.existsSync(destParent))
            fs.mkdirSync(destParent, { recursive: true })
    }
    catch (err) {console.error(err);}

    destFile = path.resolve(destParent, htmlFile);

    return {parsedUrl: parsedUrl, url: url, path: parentDir, file: destFile, binary: matchedPattern2, dir: destParent};
}

async function process_result(link, result, resolve) {
    //await new Promise((resolve) => {
    try {
        const url = link.url;
        const html = result.html; 
        const href = result.href; 
        if (href !== url) {
            // function create_redirect() {
                const newlink = await add_link(href);
                asx.update_link_redirect(newlink.key, url);
                asx.update_link_crawling_status(newlink.index, 1);
            // }
            // create_redirect();
        }
        var file = create_dest_file(href);
        fs.writeFileSync(file.file, html);
    
        asx.update_link_crawling_status(link.index, 1);
    
        const $ = cheerio.load(html);

        async.eachSeries($('a'), (elem, done) => {
            const crawled_url = elem.attribs.href;
            if (crawled_url)
                process_url(crawled_url, result, done);
            else
                done();
        }, (err)=>{
            if (err)
                console.error(err);
            resolve();
        });
    }
    catch (err) {
        console.error(err);
        resolve();
    }
        // $('a').each((idx, elem) => {
        //     const crawled_url = elem.attribs.href;
        //     if (crawled_url)
        //         process_url(crawled_url, result);
        // });
    
        // if (idle)
        //     eventEmitter.emit('crawl');


    // });
}

async function crawl(link, waitFor, callback, errorCalback) {

        await new Promise((resolve, reject) => {
            try {
                const url = link.url;
                var parsedUrl = null;
                try { parsedUrl = new URL(url); } catch(err) {}

                var file = create_dest_file(url);
                var destFile = file.file;

                asx.update_link_crawling_status(link.index, 0);

                if (!useNightmare || url.match(/pdf/i) || file.binary) {
                    try {
                        console.log('#' + link.index + " downloading file: " + url);
                        var uri_info = {
                            href: url, 
                            origin: null, 
                            baseurl: parsedUrl.protocol + "//" + parsedUrl.host + file.dir, 
                            html: null, 
                            host: location.host, protocol: location.protocol};
                        download(file, () => {
                            asx.update_link_crawling_status(link.index, 1);
                        });
                    }
                    catch(err) {
                        console.error(err);
                    }
                    resolve();
                } 
                else {

                    var nm = nightmare
                        .goto(url);

                    if (waitFor)
                        nm.wait(waitFor);

                    // the root
                    if (parsedUrl && parsedUrl.pathname === '/') {
                        //console.log(dimensions);
                        var screenshotFile = path.resolve(file.dir, './screenshot.png');
                        nm.wait(1000)
                        .screenshot(screenshotFile);
                    }

                    nm.evaluate(() => {
                        return ({href: location.href, origin: location.origin, baseurl: document.baseURI, html: document.documentElement.innerHTML, host: location.host, protocol: location.protocol});
                    })
                    .then((result) => {
                        process_result(link, result, resolve);
                    })
                    .catch((err) => {
                        if (err)
                            console.error(err);
                        if (errorCalback)
                            errorCalback();
                        // don't reject, as it will break the loop for links crawling
                        // reject(err);
                        resolve();
                    }  ).catch();
                }
                
    } 
    catch (err) {
        if (err)
            console.error(err);
        if (errorCalback)
            errorCalback();
        resolve(err);
    }        
});
//.end()
//  .then((html) => {
//       var destFile = dataPath + path.sep + "statistics.html";
//       fs.writeFileSync(destFile, html);

//       client.hset('asx:profile:' + symbol, "crawled", "true");

//       var timeMs = (5 + 31 * Math.random()) * 1000;
//       console.log("Next job will start in " + ms + 'ms');
//       setTimeout(done, timeMs);
//  })
//  .catch(error => {
//    console.error('Crawl statistics failed:', error);
//    done();
//  });
}

var index = 0;

// once this program gets run, we will look in the links table and get those uncrawled yet
// 
async function crawl_next() {
    idle = 0;
    var link = null;
    const count = await asx.get_links_count();
    var lastSkip = -1;
    var lastHost = null;
    var lastHostCount = 0;

    try {
        while (index < count) {
            link = await asx.get_allowed_link_in_seeds(index);

            const parsedUrl = new URL(link.url);

            if (parsedUrl.hostname !== lastHost || (parsedUrl.hostname === lastHost && lastHostCount < 6)) {
                if (parsedUrl.hostname === lastHost)
                    ++lastHostCount;
                else {
                    lastHostCount = 0;
                    lastHost = parsedUrl.hostname;
                }

                console.log('#' + link.index + ", crawling " + link.url + ", index: " + link.index);
                await crawl(link);
            }
            else {
                // skipping
                console.error("skipping this for now: " + link.url);
                if (lastSkip === -1)
                    lastSkip = link.index;
            }

            index = link.index + 1;
        }
    } catch (err) {
        console.error(err);
        if (err === 'end of queue') {

            if (idle) {
                if ( lastSkip >= (count - 1)) {
                    console.log("Reach the end of queue, exiting...");

                    process.exit(0);
                }
                else {
                    index = lastSkip;
                    eventEmitter.emit('crawl');
                }
            }
  
        }
    }

    console.log("Crawler idle");
    idle = 1;

    if (lastSkip < count) {
        index = lastSkip;
        eventEmitter.emit('crawl');
    }
}

eventEmitter.addListener('crawl', () => {
    if (seeds && seeds.length) {
        seeds.map((url, index) => {
            asx.add_link(url);
        });
    }
    
    crawl_next();
});

eventEmitter.emit('crawl');

process.on('uncaughtException', function(err) {
    console.log('Caught exception: ' + err);
    eventEmitter.emit('crawl');
  });