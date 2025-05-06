/**
 * @module utils
 * @description Utility functions for creating destination files and directories.
 * @requires fs
 * @requires path
 */
const fs = require('fs');
const path = require('path');

const pattern_assets = /^(.*\.(js|css|png|jpg|jpeg|gif|svg|ico|webp|ttf|woff|woff2|eot))$/i;
const pattern1 = /^(.*\.(htm|html|pdf|txt|xlsx|xls|ppt|pptx|doc|docx))$/i;
const pattern2 = /^(.*\.(pdf|txt|xlsx|xls|ppt|pptx|doc|docx))$/i;

class Utils {

    constructor() {
        this.hasher = null;
    }

    set_hasher(hasher) {
        this.hasher = hasher;
    }

    create_dest_file (url, options) {
            options = options || {};
            var self = this;
            var ext;
            var local_path = options.local_path;
            var parsedUrl;
            var type = options.type || 'html';
            try{
                parsedUrl = new URL(url || options.url);
            }
            catch (err) {
                console.error(err);
                return null;
            }
            const whichPath = (typeof local_path !== 'undefined' && local_path !== null) ? local_path : parsedUrl.hostname;
            const localArchivePath = path.resolve(options.webroot || './', whichPath);
            var htmlFile;
            var lastChar = null;
            var parentDir;
            var matchedPattern2 = false;
            var destFile;
            var pathname = parsedUrl.pathname;
            // we need to unescape the pathname
            try {
                pathname = decodeURIComponent(pathname);
            }
            catch (err) {
                console.error(err);
                pathname = parsedUrl.pathname; // just use the original pathname then
            }
            try {
                lastChar = pathname[pathname.length - 1];
            } catch (err) { console.error(err) }
            
            if (lastChar && lastChar === '/') {
                htmlFile = 'index.html';
                parentDir = pathname;
                ext = ".html";
            }
            else {
                var lastSegment = path.basename(pathname);
                if (typeof options.parentDir !== 'undefined' && options.parentDir !== null) {
                    parentDir = options.parentDir;
                }
                else {
                    if (typeof local_path !== 'undefined' && local_path !== null) {
                        parentDir = local_path;
                    }
                    else 
                        parentDir = pathname.substr(0, pathname.length - lastSegment.length);
                }
                if (options.type && options.type === 'image') {
                    /**
                     * Because image url is quite unique, it can be blob, data, etc.
                     */
                    matchedPattern2 = true;
                    htmlFile = lastSegment;
                    // if lastSegment has a dot, we can get the ext
                    if (lastSegment.indexOf('.') > -1)
                        ext = path.extname(lastSegment);
                    else
                        ext = options.ext;
                }
                else {
                    parentDir = local_path || pathname.substr(0, pathname.length - lastSegment.length);
                    if (lastSegment.match(pattern_assets)) {
                        type = 'asset';
                        matchedPattern2 = true;
                        htmlFile = lastSegment;
                        ext = path.extname(lastSegment);
                    }
                    else if (lastSegment.match(pattern1)) {
                        if (lastSegment.match(pattern2))
                            matchedPattern2 = true;
                    }
                    var pos = lastSegment.lastIndexOf('.');
                    if (!ext) {
                        if (pos > -1) {
                            ext = lastSegment.substring(pos, pathname.length);
                            htmlFile = lastSegment;
                        }
                        else
                            ext = options.ext;
                    }
                    if (!htmlFile) {
                        htmlFile = lastSegment + (parsedUrl.search ? parsedUrl.search : '') + (ext || '');
                    }
                }
            }
            var destParent = path.resolve(localArchivePath, './' + parentDir);
            try {
                if (!fs.existsSync(destParent))
                    fs.mkdirSync(destParent, { recursive: true });
            }
            catch (err) { console.error(err); }
            
            if (ext && ext.length > 0)
                destFile = path.resolve(destParent, htmlFile);

            let retOjb = {
                name: htmlFile,
                parsedUrl: parsedUrl,
                url: url,
                path: parentDir,
                file: options.file || destFile,
                binary: matchedPattern2,
                dir: destParent,
                hash: this.hasher? this.hasher(parsedUrl) : null,
                type: type,
            };
            try {
                retOjb.exists = fs.existsSync(destFile);
            }
            catch (err) {
                console.error(err);
                retOjb.exists = false;
            }

            return retOjb;
    }
}

module.exports = new Utils();