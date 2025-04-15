/**
 * We are crawling X (formerly Twitter) and need to process the HTML response.
 * Bascially, we have a few types of pages:
 * 1. Tweet pages (e.g., https://twitter.com/_e_tang/status/1234567890)
 * 2. User pages (e.g., https://twitter.com/_e_tang)
 * 3. Home pages (e.g., https://twitter.com/home)
 * 4. Search pages (e.g., https://twitter.com/search?q=example)
 * 5. Lists pages (e.g., https://twitter.com/i/lists/)
 * 6. Explore pages (e.g., https://twitter.com/i/explore)
 * 7. Notifications pages (e.g., https://twitter.com/notifications)
 * 8. Messages pages (e.g., https://twitter.com/messages)
 * 
 * Now we just focus on extracting the tweets from user page
 * 
 */

const cheerio = require('cheerio');
const fs = require('fs');
const https = require('https');
const path = require('path');

const uu = require('url-unshort')()

const Processor = require('./base');

class XProcessor extends Processor {
    constructor(options) {
        super('x', 'X Processor');
        this.outputDir = './output'; // Default output directory
        this.outputFile = 'tweets.json'; // Default output file
    }

    extractMedia($, tweetElement, tweetId) {
        const media = [];
        const imagesDir = path.join(this.outputDir, 'images'); // Destination folder for images

        // Ensure the images directory exists
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }

        $(tweetElement).find('img[src]').each((index, img) => {
            const imgSrc = $(img).attr('src');
            console.log(`Image source: ${imgSrc}`);
            // Check if the image source is a Twitter media URL
            if (imgSrc && imgSrc.startsWith('https://pbs.twimg.com/media/')) {
                let parsedUrl = new URL(imgSrc);
                // check query to if it has format, if yes then extract it
                let query = parsedUrl.searchParams.get('format');
                let ext = "";
                if (query) {
                    ext = '.' + query;
                }

                const mediaFileName = `${tweetId}_${path.basename(imgSrc).split('?')[0]}` + ext; // Ensure the file name is unique
                const mediaFilePath = path.join(imagesDir, mediaFileName);

                // Download and save the image
                const file = fs.createWriteStream(mediaFilePath);
                https.get(imgSrc, (response) => {
                    response.pipe(file);
                    file.on('finish', () => file.close());
                }).on('error', (err) => {
                    console.error(`Error downloading image ${imgSrc}:`, err);
                });

                media.push(mediaFilePath);
            }
        });

        return media;
    }

    extractLinks($, tweetElement) {
        /**
         * I would like to include all external media links (e.g., videos, gifs, etc.) in the media array.
         * However, I need to check if the media is a video or gif and handle it accordingly.
         * We don't need to download them, we will still save the links in the media array.
         */
        const links = [];
        $(tweetElement).find('a').each((index, link) => {
            const href = $(link).attr('href');
            if (href && !href.startsWith('/')) { // Exclude internal links
                // unshort the URL if it's a shortened link
                uu(href, (err, unshortenedUrl) => {
                    if (err) {
                        console.error(`Error unshortening URL ${href}:`, err);
                        return;
                    }
                    // Check if the URL is a video or gif
                    if (unshortenedUrl.includes('video') || unshortenedUrl.includes('gif')) {
                        // Add the unshortened URL to the media array
                        links.push(unshortenedUrl);
                    }
                    // Add the unshortened URL to the links array
                    else if (unshortenedUrl.includes('http')) {
                        links.push(unshortenedUrl);
                    }
                });
            }
        });
        return links;
    }

    extractTweetData($, tweetElement) {
        // Find the tweet link and extract the ID
        const tweetLink = $(tweetElement).find('a[href*="/status/"]').attr('href');
        const tweetId = tweetLink ? tweetLink.split('/status/')[1] : null;

        const tweetText = $(tweetElement).find('[data-testid="tweetText"]').text().trim();
        const dateText = $(tweetElement).find('time').attr('datetime');
        const media = this.extractMedia($, tweetElement, tweetId);
        const links = this.extractLinks($, tweetElement);

        let tweetData = {
            id: tweetId,
            date: dateText,
            tweet: tweetText,
        };

        if (media.length > 0) {
            tweetData.media = media;
        }
        if (links.length > 0) {
            tweetData.links = links;
        }
        return tweetData;
    }

    loadExistingTweets() {
        try {
            const data = fs.readFileSync(this.outputFile, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            console.log(`No existing ${this.outputFile} found. Creating a new one.`);
            return [];
        }
    }

    mergeTweets(existingTweets, newTweets) {
        const existingTweetTexts = new Set(existingTweets.map(t => t.tweet));
        const mergedTweets = [...existingTweets].sort((a, b) => new Date(b.date) - new Date(a.date)); // Sort existing tweets by date

        for (const newTweet of newTweets) {
            if (!existingTweetTexts.has(newTweet.tweet)) {
                mergedTweets.push(newTweet);
            }
        }
        return mergedTweets;
    }

    saveTweets(tweets) {
        try {
            const dir = path.dirname(this.outputFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(this.outputFile, JSON.stringify(tweets, null, 2));
            console.log(`Tweets saved to ${this.outputFile}`);
        } catch (err) {
            console.error(`Error saving tweets to ${this.outputFile}:`, err);
        }
    }
    
    process_html(result, options, resolve, reject) {
        // Implement the X processing logic here
        // For example, let's just return the data as is for now
        
        // get the username from the URL
        const url = result.href;
        let ret = false;
        try {
            const username = url.split('/')[3];
            // this.outputDir += path.join(this.outputDir, `${username}`); // Set the output file based on the username
            this.outputDir = username;
            this.outputFile = path.join(this.outputDir, 'tweets.json'); // Set the output file based on the username
            console.log(`Output file set to: ${this.outputDir}`);
        }
        catch (err) {
            console.error('Error extracting username from URL:', err);
        }
        const tweets = [];
        const $ = cheerio.load(result.html);
        console.log('Processing HTML with XProcessor');

        const existingTweets = this.loadExistingTweets();
        const existingTweetCount = existingTweets.length;
        console.log(`Existing tweets count: ${existingTweetCount}`);
        console.log('Extracting tweets from HTML...');

        $('div[data-testid="cellInnerDiv"]').each((index, element) => {
            const tweetData = this.extractTweetData($, element);
            console.log(`Tweet ID: ${tweetData.id}`);
            console.log(`Tweet text: ${tweetData.tweet}`);
            console.log(`Tweet date: ${tweetData.date}`);
            if (tweetData.tweet) {
                tweets.push(tweetData);
            }
        });

        const updatedTweets = this.mergeTweets(existingTweets, tweets);
        if (updatedTweets.length > existingTweetCount) {
            console.log(`Found ${updatedTweets.length - existingTweetCount} new tweets.`);
            this.saveTweets(updatedTweets);
            ret = true;
        }
        else {
            console.log('No new tweets found.');
        }
        if (resolve)
            resolve();
        return { failed: ret };
    }
}

module.exports = XProcessor;