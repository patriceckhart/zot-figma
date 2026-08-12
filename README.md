# zot Figma bridge

A zot extension that lets the agent inspect and edit the file currently open in Figma Design or FigJam.

Figma does not expose a public canvas-write REST API. This project therefore has two cooperating parts:

1. A Go zot extension, launched directly with `go run .` (no prebuilt binary).
2. A development Figma plugin that executes canvas operations in the open file.

## Install from GitHub

1. Install the extension from GitHub:

   ```sh
   zot ext install https://github.com/patriceckhart/zot-figma
   ```

   `zot ext install` clones the repository into zot's extension directory. A Git URL cannot be passed directly to `zot --ext`, which only accepts local paths.

2. In the Figma desktop app, choose **Plugins > Development > Import plugin from manifest...**. On macOS, press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> in the file picker, paste this path, and press Return:

   ```text
   ~/Library/Application Support/zot/extensions/figma/figma-plugin/manifest.json
   ```

   If `XDG_STATE_HOME` is configured, the manifest is instead at:

   ```text
   $XDG_STATE_HOME/zot/extensions/figma/figma-plugin/manifest.json
   ```

3. Start zot normally:

   ```sh
   zot
   ```

4. Run **zot bridge** from Figma's development plugins menu and leave its small window open.
5. Ask zot to inspect the selection, create a design, make components, move or resize nodes, or create FigJam stickies and connectors.

## Run from a local checkout

For development, clone the repository and load it directly:

```sh
git clone https://github.com/patriceckhart/zot-figma ~/Developer/zot-figma
zot --ext ~/Developer/zot-figma
```

Then import this manifest in Figma:

```text
~/Developer/zot-figma/figma-plugin/manifest.json
```

The bridge listens only on `127.0.0.1:38451`. Only the currently open file is accessible, and Figma displays the plugin while it is active.

## Tools

- `figma_status`: checks whether the Figma plugin is connected.
- `figma_read`: reads the current selection, page, or document tree.
- `figma_create`: creates nested Design nodes, components, instances, FigJam stickies, and connectors.
- `figma_update`: changes node geometry, appearance, text, layout, or component properties.
- `figma_delete`: removes nodes.
- `figma_select`: selects nodes and optionally brings them into view.
- `figma_export`: exports a node as PNG, JPG, SVG, or PDF and returns it to the model.

## Limitations

- The plugin must remain open in the target Figma tab.
- This manipulates canvas objects through Figma's Plugin API. It does not simulate pointer input or control Figma's application UI.
- Team-library components can be instantiated only when their component key is known and Figma permits importing it.
- A Figma plugin can edit only the file in which it is currently running. Creating a new Figma file itself still happens in Figma's UI.

## License
MIT
