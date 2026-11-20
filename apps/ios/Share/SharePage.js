// Safari runs this in a page someone shares with Atd (NSExtensionJavaScriptPreprocessingFile), and
// the share extension receives what it hands completionFunction: the page's address and title, what
// the person selected, and the page's text. Atd runs it too, in a page it loads for a link another
// app shared (Sources/AtdShareUI/PageReader.swift). Atd keeps at most 12,000 characters; the
// slices only keep a long page from crossing the process boundary whole.
var ExtensionPreprocessingJS = {
  run: function (parameters) {
    var selection = window.getSelection ? String(window.getSelection()) : '';
    var text = document.body ? document.body.innerText : '';
    parameters.completionFunction({
      url: document.URL,
      title: document.title,
      selection: selection.slice(0, 20000),
      text: text.slice(0, 20000),
    });
  },
  finalize: function () {},
};
