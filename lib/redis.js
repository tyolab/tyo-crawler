const redis = require("redis");
const crypto = require('crypto');

Object.prototype.getName = function() { 
    var funcNameRegex = /function (.{1,})\(/;
    var results = (funcNameRegex).exec((this).constructor.toString());
    return (results && results.length > 1) ? results[1] : "";
};

function RedisClient(opts) {
    opts = opts || {};

    this.version = opts.version || 3;

    this.namespace = opts.namespace || 'links:tmp';
    this.separator = opts.separator || '-';
    this.links_hash = opts.links_hash || (this.namespace + this.separator + 'hash');
    this.link_key_prefix = opts.link_key_prefix || (this.namespace + this.separator + 'l:');

    this.client = null; // redis.createClient(opts.port, opts.host);
}

RedisClient.prototype.connect = async function (opts) {
    this.client = redis.createClient(opts);
    await this.client.connect();
    this.client.on('error', (err) => console.log('Redis Client Error', err));
    this.client.on('connect', () => console.log('Redis Client Connected'));
    this.client.on('ready', () => console.log('Redis Client Ready'));
    this.client.on('end', () => console.log('Redis Client End'));
    this.client.on('reconnecting', () => console.log('Redis Client Reconnecting'));
    this.client.on('warning', (err) => console.log('Redis Client Warning', err));
};

RedisClient.prototype.promisify = async function () {
    var args = Array.from(arguments);
    var func = args.shift();
    var self = this;

    var retValue = null;
    try {
        if (this.version >= 4) {
            retValue = await func.apply(self.client, args);
        }
        else {
            retValue = await new Promise((resolve, reject) => {
                var cb = function (err, value) {
                    if (err) return reject(err);
                    resolve(value);
                };
                args.push(cb);
                func.apply(self.client, args);
            });
        }
    }
    catch (err) {
        console.error(err);
    }
    return retValue;
};

RedisClient.prototype.create_hash_from_url = function (newUrl) {
    var pathUrl = newUrl.host;
    if (newUrl.pathname)
        pathUrl += newUrl.pathname;
    if (newUrl.search)
        pathUrl += newUrl.search;

    return crypto.createHash('md5').update(pathUrl).digest('hex');
};

RedisClient.prototype.get_link_hash = async function (url) {
    var hash;
    if (typeof url === 'string') {
        const newUrl = new URL(url);
        hash = this.create_hash_from_url(newUrl);
    }
    else if (url.getName() === 'URL')
        hash = this.create_hash_from_url(url);
    else if (url.hash && url.hash.length)
        hash = url.hash; 

    if (hash) {
        var linkkey = await this.promisify(
            this.version >= 4 ? this.client.hGet : this.client.hget,
            this.links_hash,
            hash
        );

        var linkhash = {};
        linkhash.hash = hash;
        linkhash.key = linkkey;
        return linkhash;
    }
    return null;
};

RedisClient.prototype.update_link_hash = async function (hash, key) {
    await this.promisify(
        this.version >= 4 ? this.client.hSet : this.client.hset,
        this.links_hash,
        hash,
        key
    );
};

RedisClient.prototype.update_link_redirect = async function (key, from) {
    await this.promisify(
        this.version >= 4 ? this.client.hSet : this.client.hset,
        key,
        'redirect',
        from
    );
};

RedisClient.prototype.add_link = async function (url, callback, options) {
    options = options || {};

    var count = await this.get_links_count();
    var index = count; // add to the end

    var linkhash = await this.get_link_hash(url);

    var key;
    if (!linkhash.key) {
        key = this.link_key_prefix + index;
        console.log("adding link " + key + ", " + url);

        await this.promisify(
            this.version >= 4 ? this.client.hSet : this.client.hset,
            key,
            'url',
            url
        );
        // -1, 0, 1: 0 in progress
        await this.promisify(
            this.version >= 4 ? this.client.hSet : this.client.hset,
            key,
            'crawled',
            -1
        );

        await this.update_link_hash(linkhash.hash, key);
        await this.set_links_count(count + 1);
    }
    else {
        key = linkhash.key;
        index = parseInt(key.split(':')[2]);

        if (options && options.force) {
            await this.update_link_crawling_status(index, -1);
            console.log("updating link status " + key + ", " + url + " to -1");
        }
    }

    var link = { url: url, index: index, key: key };

    if (callback && typeof callback === 'function')
        callback(link);

    return link;
};

RedisClient.prototype.add_allowed_host = async function (host, root) {
    if (host.match('://')) {
        const newUrl = new URL(host);
        host = newUrl.hostname;
    }
    if (root)
        host += root;
    await this.client.hSet(this.namespace + ':allowed', host, 1);
};

RedisClient.prototype.set_links_count = async function (count) {
    count = count || 0;
    await this.promisify(
        this.version >= 4 ? this.client.hSet : this.client.hset,
        this.namespace,
        'count',
        count
    );
};

RedisClient.prototype.get_links_count = async function () {
    var count = await this.promisify(
        this.version >= 4 ? this.client.hGet : this.client.hget,
        this.namespace,
        'count'
    );
    return (count ? parseInt(count) : 0) || 0; 
};

RedisClient.prototype.get_link_in_seeds = async function (index) {
    if (typeof index == 'undefined' || index == null)
        index = 0;
    if (index < 0)
        index = 0;
    const count = await this.get_links_count();
    if (index > (count - 1))
        throw new Error("end of queue");

    var link = await this.promisify(
        this.version >= 4 ? this.client.hGetAll : this.client.hgetall,
        this.link_key_prefix + index
    );
    while (link && link.crawled !== '-1') {
        if (index == 1654)
            console.log("link #" + index + ": " + link.url);

        console.error("skipping link #" + index + ": " + link.url);
        (++index);
        if (index >= count)
            throw new Error("end of queue");
        link = await this.promisify(
            this.version >= 4 ? this.client.hGetAll : this.client.hgetall,
            this.link_key_prefix + index
        );
    }

    link = link || { url: null };
    link.index = index;

    return link;
};

RedisClient.prototype.get_queue_info = async function () {
    const info = await this.promisify(this.client.get, this.namespace + 'queue');
    return info || { index: 0, size: 0 };
};

RedisClient.prototype.is_link_allowed = async function (url) {
    if (!url)
        return false; 

    var toMatchUrl = "*";
    if (url.parsedUrl && url.path) {
        toMatchUrl = url.parsedUrl.hostname + url.path;
    }
    else {
        const newUrl = new URL(url);
        toMatchUrl = newUrl.hostname;
    }

    var allowed = '0'; 
    if (toMatchUrl && toMatchUrl.length)
        allowed = await this.promisify(
            this.version >= 4 ? this.client.hGet : this.client.hget,
            this.namespace + '-allowed',
            toMatchUrl
        );
    return allowed === '1';
};

RedisClient.prototype.get_allowed_link_in_seeds = async function (index) {
    index = index || 0; 
    var link = await this.get_link_in_seeds(index);
    var allowed = await this.is_link_allowed(link.url);
    while (!allowed) {
        link = await this.get_link_in_seeds(++link.index);
        allowed = await this.is_link_allowed(link.url);
    }
    return link;
};

RedisClient.prototype.get_config = async function () {
    // Implementation for retrieving configuration if needed.
};

RedisClient.prototype.update_link_crawling_status = async function (index, status) {
    index = index || 0;
    await this.promisify(
        this.version >= 4 ? this.client.hSet : this.client.hset,
        this.link_key_prefix + index,
        'crawled',
        status
    );
};

RedisClient.prototype.select = async function (db_id) {
    return await this.promisify(this.client.select, db_id);
};

RedisClient.prototype.get_cookies = async function (namespace) {
    namespace = namespace || this.namespace;
    const cookiesString = await this.promisify(
        this.version >= 4 ? this.client.hGet : this.client.hget,
        namespace,
        'cookies'
    );
    if (cookiesString) {
        try {
            const parsedCookies = JSON.parse(cookiesString);
            // Check if the parsedCookies is an array of strings, if so, parse each string
            if (Array.isArray(parsedCookies) && parsedCookies.every(cookie => typeof cookie === 'string')) {
                return parsedCookies.map(cookieString => JSON.parse(cookieString));
            }
            return parsedCookies;
        } catch (error) {
            console.error("Error parsing cookies:", error);
            return null;
        }
    }
    return null;
};

RedisClient.prototype.set_cookies = async function (cookies, namespace) {
    namespace = namespace || this.namespace;
    if (typeof cookies !== 'string') {
        // Convert each cookie to a string if it's an object
        const stringifiedCookies = cookies.map(cookie => {
            if (typeof cookie === 'object') {
                return JSON.stringify(cookie);
            }
            return cookie;
        });
        cookies = JSON.stringify(stringifiedCookies);
    }
    
    return await this.promisify(
        this.version >= 4 ? this.client.hSet : this.client.hset,
        namespace,
        'cookies',
        cookies
    );
};

RedisClient.prototype.exists = async function (key) {
    var value = await this.promisify(this.client.exists, key);
    return 1 == value;
};

RedisClient.prototype.set = async function (key, value) {
    return await this.promisify(this.client.set, key, value);
};

RedisClient.prototype.hset = async function (key, field, value) {
    return await this.promisify(
        this.version >= 4 ? this.client.hSet : this.client.hset,
        key,
        field,
        value
    );
};

RedisClient.prototype.hmset = async function (key, field, value) {
    return await this.promisify(
        this.version >= 4 ? this.client.hSet : this.client.hset,
        key,
        field,
        value
    );
};

RedisClient.prototype.hget = async function (key, field, fallbackValue) {
    var value = await this.promisify(
        this.version >= 4 ? this.client.hGet : this.client.hget,
        key,
        field
    );
    return value || fallbackValue;
};

RedisClient.prototype.get = async function (key, fallbackValue) {
    var value = await this.promisify(this.client.get, key);
    return value || fallbackValue;
};

RedisClient.prototype.keys = async function (pattern, fallbackValue) {
    var value = await this.promisify(this.client.keys, pattern);
    return value || fallbackValue;
};

RedisClient.prototype.delete_keys = async function (key) {
    var keys = await this.keys(key);
    if (!keys || keys.length <= 0)
        return -1;
    
    var value;
    for (var i = 0; i < keys.length; ++i) {
        value = await this.promisify(this.client.del, keys[i]);
    }
    return value;
};

RedisClient.prototype.delete_keys2 = function (key) {
    var self = this;
    var stream = self.client.scanStream({
        match: key,
        count: 100
    });

    stream.on('data', function (resultKeys) {
        if (resultKeys.length) {
            self.client.del(resultKeys);
        }
    });
};

module.exports = RedisClient;
