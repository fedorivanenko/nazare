const path = require("node:path");
const load = require("node-gyp-build");

module.exports = load(path.join(__dirname, "../../.."));
