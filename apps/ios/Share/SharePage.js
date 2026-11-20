// Safari runs this in the page someone shares (NSExtensionJavaScriptPreprocessingFile), and the
// share extension receives what it hands to completionFunction.
// Stub (F0a): the page's address and title. WS-B replaces it.
var ExtensionPreprocessingJS = {
  run: function (parameters) {
    parameters.completionFunction({ url: document.URL, title: document.title });
  },
  finalize: function () {},
};
