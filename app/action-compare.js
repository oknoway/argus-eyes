var argumentLoader = require('./cli/argumentLoader');
var log            = require('./log');
var util           = require('./util');
var child_process  = require('child_process');
var fs             = require('fs');
var path           = require('path');
var glob           = require('glob').sync;
var rimraf         = require('rimraf').sync;
var BlinkDiff      = require('blink-diff');
var PNGImage       = require('pngjs-image');

/**
 * Action `compare`
 *  Compares left and right sets of screenshots, reporting any difference
 *
 * @param {String} id1 - Left set of screenshots
 * @param {String} id2 - Right set of screenshots
 * @return {Boolean}
 */
module.exports = function compare(id1, id2) {

    var config = argumentLoader.getConfig();

    id1 = id1.replace('/', '-');
    id2 = id2.replace('/', '-');
    var diffDirectory = config.base + '/diff_' + id1 + '_' + id2;
    var dir1 = glob(config.base + '/' + id1 + '/**/*.png');
    var dir2 = glob(config.base + '/' + id2 + '/**/*.png');

    // See if the given left and right sides make sense
    if (id1 === id2) {
        throw new Error('You cannot compare a set with itself');
    }
    if (!util.directoryExists(config.base + '/' + id1)) {
        throw new Error(util.format("Left side not found: '%s'", id1));
    }
    if (!util.directoryExists(config.base + '/' + id2)) {
        throw new Error(util.format("Right side not found: '%s'", id2));
    }

    // Clean up a potentially existing diff directory
    if (util.directoryExists(diffDirectory)) {
        rimraf(diffDirectory);
    }
    util.mkdir(diffDirectory);

    showDirectoryDifferenceWarnings(dir1, dir2, id1, id2);

    // Create diff images, in parallel
    var differences = 0;
    dir1.forEach(file1 => {

        var filename = path.relative(config.base + '/' + id1, file1);
        var diffFile = diffDirectory + '/' + filename;
        var file2    = config.base + '/' + id2 + '/' + filename;

        util.mkdir(path.dirname(diffFile));

        var diff = new BlinkDiff({
            imageAPath: file1,
            imageBPath: file2,
            imageOutputPath: diffFile,
            threshold: 0,
            delta: 0,
            outputMaskOpacity: 1,
            composition: false
        });
        try {
            var result = diff.runSync();
        } catch (e) {
            log.warning(util.format("Image comparison returned an error for file: '%s'", filename));
            log.warning(util.prefixStdStream(' blinkdiff', JSON.stringify(e)));
            return;
        }

        var img1 = PNGImage.readImageSync(file1);
        var img2 = PNGImage.readImageSync(file2);
        if (img1.getWidth() !== img2.getWidth() || img1.getHeight() !== img2.getHeight()) {
            log.verbose('Image dimensions differ left and right: ' + filename);
        }

        // Dropout on success
        if (result.differences === 0) {
            fs.unlinkSync(diffFile);
            log.verbose(util.format("Found exactly equal: '%s'", filename));
            return;
        }

        // What percentage of pixels changed?
        var pixelsChanged = result.differences;
        var percentage = (pixelsChanged / (result.width * result.height) * 100);

        // Report when verbose
        if (pixelsChanged > 0 && percentage > config.threshold) {
            differences++;
            log.verbose(util.format(
                "Difference (%d%) above threshold (%d%) found for: '%s'",
                percentage.toFixed(2),
                config.threshold,
                filename));
        } else if (pixelsChanged > 0) {
            fs.unlinkSync(diffFile);
            log.verbose(util.format(
                "Difference (%d%) not bigger than threshold (%d%) for: '%s'",
                percentage.toFixed(2),
                config.threshold,
                filename));
        }
    });

    util.removeEmptyDirectories(diffDirectory);
    reportResults(diffDirectory, differences);

    return !differences;

};

/**
 * Show warnings for non-existing files in either comparison directory
 *
 * @param {String[]} dir1 - List of files in the left directory
 * @param {String[]} dir2 - List of files in the right directory
 * @param {String} id1 - Identifier of the left directory
 * @param {String} id2 - Identifier of the right directory
 */
function showDirectoryDifferenceWarnings(dir1, dir2, id1, id2) {
    log.verbose(util.format(
        'Found a total of %d screenshot%s on the left side',
        dir1.length,
        util.plural(dir1.length)));
    log.verbose(util.format(
        'Found a total of %d screenshot%s on the right side',
        dir2.length,
        util.plural(dir2.length)));
    getDirectoryDiff(dir1, id1, id2, file => log.warning('Screenshot not found in right side: ' + file));
    getDirectoryDiff(dir2, id2, id1, file => log.warning('Screenshot not found in left side: ' + file));
}

/**
 * Invokes a callback for every file that does not exist in the right side of the comparison
 *
 * @param {String[]} dir - List of files in the left directory
 * @param {String} id1 - Identifier of the left directory
 * @param {String} id2 - Identifier of the right directory
 * @param {Function} cb - Callback for each difference, passed a single argument, the file
 */
function getDirectoryDiff(dir, id1, id2, cb) {
    dir.forEach(file1 => {
        var file2 = file1.replace(id1, id2);
        if (!util.fileExists(file2)) {
            cb(file2);
        }
    });
}

/**
 * Output comparison results
 *
 * @param {String} diffDirectory
 * @param {Number} differences
 */
function reportResults(diffDirectory, differences) {
    if (differences) {
        log.error(util.format('Found %d difference%s',
            differences,
            util.plural(differences)));
        log.error(util.format("Diff image%s saved in: '%s'",
            util.plural(differences),
            path.relative(process.cwd(), diffDirectory)));
    } else {
        log.success('Found no significant differences');
    }
}
