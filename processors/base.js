
function BaseProcessor() {
}

BaseProcessor.prototype.process_html = function (result, options, resolve, reject) {
    throw new Error("Not implemented");
}

module.exports = BaseProcessor;
