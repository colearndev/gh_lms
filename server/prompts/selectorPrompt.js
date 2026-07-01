const { renderPromptTemplate } = require("./promptTemplate");

function createSelectorPrompt({ level, expectedCount, profileSignal, context, options }) {
  return renderPromptTemplate("selector.md", {
    level,
    expected_count: expectedCount,
    profile_signal_json: JSON.stringify(profileSignal),
    context_json: JSON.stringify(context),
    options_json: JSON.stringify(options)
  });
}

module.exports = {
  createSelectorPrompt
};
