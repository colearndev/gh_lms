const { renderPromptTemplate } = require("./promptTemplate");

function createChatPrompt(context) {
  return renderPromptTemplate("chat.md", {
    context_json: JSON.stringify(context)
  });
}

module.exports = {
  createChatPrompt
};
