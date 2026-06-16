const { createChatPrompt } = require("../prompts/chatPrompt");

function createChatGenerator({ askGemini, serviceError }) {
  async function chat(context) {
    const prompt = createChatPrompt(context);
    const result = await askGemini(prompt, null);
    if (!result || !result.message) {
      throw serviceError("Gemini did not return a valid chat answer. Nothing was generated.", 502);
    }
    return result;
  }

  return {
    chat
  };
}

module.exports = {
  createChatGenerator
};
