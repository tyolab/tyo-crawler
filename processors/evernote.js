/**
 * @fileoverview Evernote processor
 * @author eric
 */

const cheerio = require('cheerio');
const fs = require('fs');
const https = require('https');
const path = require('path');

const Processor = require('./base');

const utils = require('../lib/utils');

class EvernoteProcessor extends Processor {
    constructor(options) {
        super('evernote', 'Evernote Processor');
        this.outputFile = 'index.md'; // Default output file
    }

    process_html(result, options, resolve, reject) {
        const notes = [];
        const downloads = [];
        const $ = cheerio.load(result.html);
        console.log('Processing HTML with EvernoteProcessor');

        console.log('Extracting notes from HTML...');

        // Find out the note title first
        const noteTitle = $('div[data-testid="view-only-title"]').text().trim();
        console.log(`Note title: ${noteTitle}`);

        // Ensure the output directory exists
        const noteFolder = path.join(this.outputDir, noteTitle.replace(/[<>:"/\\|?*]/g, '_')); // Sanitize folder name
        const resourcesFolder = path.join(noteFolder, 'resources');
        fs.mkdirSync(resourcesFolder, { recursive: true });

        // Go through each node of en-note
        let note_element = $('en-note');
        if (note_element.length === 0) {
            console.error('No en-note element found in the HTML');
            if (resolve) {
                resolve({ failed: true });
            }
            return { failed: true };
        }
        let note_children = note_element.children();
        if (note_children.length === 0) {
            console.error('No children found in the en-note element');
            if (resolve) {
                resolve({ failed: true });
            }
            return { failed: true };
        }
        // Create the note folder
        note_children.each((index, element) => {
            const tagName = $(element).prop('tagName').toLowerCase();

            // If the tag name is h2, h3, h4, h5, h6, treat it as a section title
            if (['h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) { $(element).find('span').remove();
                const sectionTitle = $(element).text().trim();
                notes.push(`## ${sectionTitle}`);
            }

            // If the tag name is div and has a class of para, treat it as a paragraph
            else if (tagName === 'div' && $(element).hasClass('para')) {
                const paragraph = $(element).text().trim();
                notes.push(paragraph);
            }

            // If the tag name is div and has a class of "en-media-image", treat it as an image
            else if (tagName === 'div' && $(element).hasClass('en-media-image')) {
                const imgSrc = $(element).find('img').attr('src');
                if (imgSrc) {
                    const imgFileName = path.basename(imgSrc).split('?')[0] + '.png'; // Ensure the file name is unique
                    const imgFilePath = path.join(resourcesFolder, imgFileName);

                    // Add a markdown image reference
                    notes.push(`![image](${path.join('resources', imgFileName)})`);

                    // Add the image to the downloads array
                    let download = utils.create_dest_file(imgSrc,{ type: "image", url: imgSrc, file: imgFilePath, local_path: resourcesFolder });
                    downloads.file = imgFilePath;
                    downloads.url = imgSrc;
                    downloads.path = resourcesFolder;
                    downloads.type = 'image';
                    downloads.push(download);
                }
            }
        });

        // Save the notes to the output file
        const outputFilePath = path.join(noteFolder, this.outputFile);
        fs.writeFileSync(outputFilePath, notes.join('\n\n'), 'utf8');
        console.log(`Notes saved to ${outputFilePath}`);

        let ret = {download: downloads, failed: false};

        //#####
        // DO NOT CALL resolve HERE
        // BECAUSE reslove is for the promise in the main process, if it resolved here, 
        // the main process will start the next crawl
        // and the download will not be completed
        // #####
        // if (resolve) {
        //     resolve(ret);
        // }
        // Return the downloads array for further processing
        return ret;
    }
}

module.exports = EvernoteProcessor;