# Menu bar status item images

Exported at 1x and 2x from the `App / Menu bar status item` component set
(`1562:59933`) in the project Figma file:
https://www.figma.com/design/PROJECT_FILE_KEY/ai?node-id=1562-59933

`electron/menu-bar.ts` loads `<state>Template.png`. The `Template` suffix makes macOS treat
each image as a template image: only its alpha channel is used, tinted for the menu bar
appearance. Re-export from Figma instead of editing these files.
