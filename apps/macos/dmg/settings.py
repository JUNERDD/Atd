# dmgbuild settings for the installer dmg. build.py passes the app, the background pair and
# layout.json as defines; layout.json is the geometry background.mjs draws against, so the icons
# land on the picture's marks.
import json

with open(defines["layout"], encoding="utf-8") as fp:
    layout = json.load(fp)

app = defines["app"]
files = [app]
symlinks = {"Applications": "/Applications"}
# Hiding extensions writes FinderInfo into the signed bundle and fails strict verification.

# LZFSE (ULFO) compresses faster and smaller than zlib (UDZO); every macOS the app supports opens it.
format = "ULFO"

background = defines["background"]
default_view = "icon-view"
show_status_bar = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
show_tab_view = False
# Finder's window bounds include its title bar; the background fills the content area below it.
window_rect = ((200, 120), (layout["width"], layout["height"] + layout["titleBar"]))
icon_size = layout["iconSize"]
text_size = layout["textSize"]
icon_locations = {
    "Atd.app": (layout["app"]["x"], layout["app"]["y"]),
    "Applications": (layout["applications"]["x"], layout["applications"]["y"]),
}
