const { createSelectorPrompt } = require("../prompts/selectorPrompt");

function createSelectorGenerator({ askGemini, serviceError, profileSignal, normalizeGraphOption, firstText }) {
  async function suggest(level, options, profile, context = {}) {
    if (!options || !options.length) {
      throw serviceError("Neo4j returned no graph options for this decision level. No AI suggestions were generated.", 422);
    }
    const normalizedOptions = options.map(normalizeGraphOption);
    const expectedCount = Math.min(5, options.length);
    const prompt = createSelectorPrompt({
      level,
      expectedCount,
      profileSignal: profileSignal(profile),
      context,
      options: normalizedOptions.slice(0, 30)
    });
    const result = await askGemini(prompt, null);
    if (!result || !Array.isArray(result.suggestions) || !result.suggestions.length) {
      throw serviceError("Gemini did not return any suggestions. Nothing was generated.", 502);
    }
    return { suggestions: normalizeSuggestions(result.suggestions, options) };
  }

  function normalizeSuggestions(suggestions, options) {
    const normalizedOptions = options.map(normalizeGraphOption);
    const expectedCount = Math.min(5, normalizedOptions.length);
    const normalized = suggestions.slice(0, expectedCount).map(function (suggestion, index) {
      const source = suggestion && (suggestion.option || suggestion.item || suggestion.node || suggestion.candidate || suggestion.choice) || suggestion;
      const sourceObject = typeof source === "object" && source !== null ? source : { value: source };
      const matched = findMatchingOption(sourceObject, normalizedOptions) ||
        findMatchingOption(suggestion, normalizedOptions) ||
        normalizedOptions[index] ||
        {};
      const merged = Object.assign({}, matched, sourceObject, suggestion);
      const code = firstText(
        sourceObject.code,
        sourceObject.Code,
        sourceObject.optionCode,
        sourceObject.option_code,
        sourceObject.value,
        suggestion.code,
        suggestion.Code,
        suggestion.optionCode,
        suggestion.option_code,
        matched.code
      );
      const title = firstText(
        sourceObject.title,
        sourceObject.Title,
        sourceObject.name,
        sourceObject.Name,
        sourceObject.label,
        sourceObject.Label,
        suggestion.title,
        suggestion.Title,
        suggestion.name,
        suggestion.Name,
        suggestion.label,
        suggestion.Label,
        suggestion.optionTitle,
        suggestion.option_title,
        matched.title,
        matched.Title,
        code
      );
      return Object.assign({}, merged, {
        code,
        uri: firstText(sourceObject.uri, suggestion.uri, matched.uri),
        title,
        titleHu: firstText(sourceObject.titleHu, sourceObject.Title_HU, suggestion.titleHu, suggestion.Title_HU, matched.titleHu),
        description: firstText(sourceObject.description, sourceObject.Description, suggestion.description, suggestion.Description, matched.description),
        reason: firstText(suggestion.reason, suggestion.fitReason, suggestion.fit_reason, suggestion.explanation, suggestion.rationale, "Gemini ranked this option, but did not provide a reason."),
        fitScore: suggestion.fitScore || suggestion.score || suggestion.fit_score || null,
        risk: firstText(suggestion.risk, "medium"),
        nextQuestion: firstText(suggestion.nextQuestion, suggestion.next_question)
      });
    });
    const used = new Set(normalized.map(function (item) {
      return String(item.code || item.uri || item.title || "").toLowerCase();
    }));
    normalizedOptions.forEach(function (option) {
      if (normalized.length >= expectedCount) return;
      const key = String(option.code || option.uri || option.title || "").toLowerCase();
      if (used.has(key)) return;
      used.add(key);
      normalized.push(Object.assign({}, option, {
        reason: "Included so the learner can compare at least five available graph options at this stage.",
        fitScore: null,
        risk: "medium",
        nextQuestion: "How does this option compare with the highlighted recommendations?"
      }));
    });
    return normalized;
  }

  function findMatchingOption(source, options) {
    if (!source) return null;
    if (typeof source !== "object") {
      const raw = String(source).trim().toLowerCase();
      return options.find(function (option) {
        return String(option.code || "").toLowerCase() === raw ||
          String(option.uri || "").toLowerCase() === raw ||
          String(option.title || "").toLowerCase() === raw;
      });
    }
    const code = firstText(source.code, source.Code, source.optionCode, source.option_code, source.value);
    const uri = firstText(source.uri, source.URI);
    const title = firstText(source.title, source.Title, source.name, source.Name, source.label, source.Label, source.optionTitle, source.option_title);
    const lowerCode = code.toLowerCase();
    const lowerUri = uri.toLowerCase();
    const lowerTitle = title.toLowerCase();
    return options.find(function (option) {
      return (lowerCode && String(option.code || "").toLowerCase() === lowerCode) ||
        (lowerUri && String(option.uri || "").toLowerCase() === lowerUri) ||
        (lowerTitle && String(option.title || "").toLowerCase() === lowerTitle);
    });
  }

  return {
    suggest,
    normalizeSuggestions,
    findMatchingOption
  };
}

module.exports = {
  createSelectorGenerator
};
