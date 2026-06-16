function createChatPrompt(context) {
  return `Return JSON {"message":"..."} as a concise career coach. Do not diagnose. Context: ${JSON.stringify(context)}`;
}

module.exports = {
  createChatPrompt
};
