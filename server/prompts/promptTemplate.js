const fs = require("fs");
const path = require("path");

const templateCache = {};

function readPromptTemplate(fileName) {
  if (!templateCache[fileName]) {
    templateCache[fileName] = fs.readFileSync(
      path.join(__dirname, fileName),
      "utf8"
    );
  }
  return templateCache[fileName];
}

function renderPromptTemplate(fileName, values) {
  const template = readPromptTemplate(fileName);
  return template.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, function (match, key) {
    return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match;
  });
}

module.exports = {
  readPromptTemplate,
  renderPromptTemplate
};
