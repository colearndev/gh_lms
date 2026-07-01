const { renderPromptTemplate } = require("./promptTemplate");

function createGrowthUnitPrompt({ shape, lengthGuide, enrichedPayload, profileSignal }) {
  return renderPromptTemplate("occupation-growth-unit.md", {
    shape_json: JSON.stringify(shape),
    length_guide_json: JSON.stringify(lengthGuide),
    payload_json: JSON.stringify({ ...enrichedPayload, lengthGuide, profile: profileSignal })
  });
}

module.exports = {
  createGrowthUnitPrompt
};
