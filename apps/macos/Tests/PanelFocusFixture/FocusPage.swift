/// Mirrors the project's surface-glass selectors and persistent composited composer child.
/// Fixed fields and counter-only delivery deliberately exclude application/service/user data.
enum FocusPage {
  static func html(glass: String) -> String {
    """
    <!doctype html><meta charset="utf-8"><style>
    html,body{background:transparent}body{margin:0;padding:65px 24px;color:white;font:16px system-ui}
    .surface-glass{margin:20px 0;border-radius:20px;background-color:rgba(32,32,32,.65);
      backdrop-filter:blur(40px);box-shadow:inset 0 0 0 1px rgba(255,255,255,.15)}
    @supports(-apple-visual-effect:-apple-system-glass-material){.surface-glass{
      background-color:transparent;backdrop-filter:none;
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.15);
      -apple-visual-effect:-apple-system-glass-material}}
    :root[data-window-active='false'] .surface-glass{background-color:rgba(32,32,32,.65);
      backdrop-filter:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.15);-apple-visual-effect:none}
    :root[data-page-glass='off'] .surface-glass{-apple-visual-effect:none;backdrop-filter:none}
    .glass-control{overflow:clip}.composer-input-scroll{will-change:transform}
    #composer,input{display:block;box-sizing:border-box;width:100%;height:56px;
      padding:15px;border:0;border-radius:20px;color:white;background:transparent;font:16px system-ui}
    #composer:focus,input:focus{outline:none;box-shadow:inset 0 0 0 2px #6af}
    </style><div>Product surface-glass first-click and borrowed keyboard probe</div>
    <div class="surface-glass glass-control"><div class="composer-input-scroll">
      <div id="composer" contenteditable="true" role="textbox"></div></div></div>
    <div class="surface-glass"><input id="search" aria-label="Model search"></div>
    <script>
    document.documentElement.dataset.pageGlass='\(glass)';
    document.documentElement.dataset.windowActive='true';
    window.pointerDowns=0;window.keyDowns=0;window.bridgeEvents=0;window.lastWindowActive=true;
    window.aiNative={deliver(message){if(message.type==='event'&&message.event==='window.active'){
      window.bridgeEvents++;window.lastWindowActive=message.payload.active;
      if('\(glass)'==='active')document.documentElement.dataset.windowActive=String(message.payload.active);
    }}};
    addEventListener('pointerdown',()=>window.pointerDowns++);
    addEventListener('keydown',()=>window.keyDowns++);
    </script>
    """
  }
}
