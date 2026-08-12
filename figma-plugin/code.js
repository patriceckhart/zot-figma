figma.showUI(__html__, { width: 300, height: 92, themeColors: true });

const rgba = value => {
  if (typeof value === "string") {
    const hex = value.replace("#", "");
    const full = hex.length === 3 ? hex.split("").map(x => x + x).join("") : hex;
    return { r: parseInt(full.slice(0, 2), 16) / 255, g: parseInt(full.slice(2, 4), 16) / 255, b: parseInt(full.slice(4, 6), 16) / 255 };
  }
  return value;
};

const paints = values => values && values.map(value => {
  if (typeof value === "string") return { type: "SOLID", color: rgba(value) };
  const paint = { ...value };
  if (paint.color) paint.color = rgba(paint.color);
  return paint;
});

const loadFont = async node => {
  if (!("fontName" in node)) return;
  if (node.fontName !== figma.mixed) await figma.loadFontAsync(node.fontName);
  else {
    const fonts = node.getRangeAllFontNames(0, node.characters.length);
    await Promise.all(fonts.map(font => figma.loadFontAsync(font)));
  }
};

function summary(node, depth = 1) {
  const out = {
    id: node.id,
    type: node.type,
    name: node.name,
    visible: node.visible,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height
  };
  if ("characters" in node) out.text = node.characters;
  if ("layoutMode" in node) {
    out.layoutMode = node.layoutMode;
    out.itemSpacing = node.itemSpacing;
    out.padding = { top: node.paddingTop, right: node.paddingRight, bottom: node.paddingBottom, left: node.paddingLeft };
  }
  if (node.type === "INSTANCE") out.componentProperties = node.componentProperties;
  if (depth > 0 && "children" in node) out.children = node.children.map(child => summary(child, depth - 1));
  return out;
}

async function find(id) {
  const node = await figma.getNodeByIdAsync(id);
  if (!node) throw new Error("Node not found: " + id);
  return node;
}

async function setProps(node, spec) {
  if (spec.name !== undefined) node.name = spec.name;
  if (spec.x !== undefined) node.x = spec.x;
  if (spec.y !== undefined) node.y = spec.y;
  if (spec.rotation !== undefined && "rotation" in node) node.rotation = spec.rotation;
  if (spec.opacity !== undefined && "opacity" in node) node.opacity = spec.opacity;
  if (spec.visible !== undefined) node.visible = spec.visible;
  if (spec.locked !== undefined && "locked" in node) node.locked = spec.locked;
  if ((spec.width !== undefined || spec.height !== undefined) && "resize" in node) node.resize(spec.width ?? node.width, spec.height ?? node.height);
  if (spec.fills !== undefined && "fills" in node) node.fills = paints(spec.fills);
  if (spec.strokes !== undefined && "strokes" in node) node.strokes = paints(spec.strokes);
  if (spec.strokeWeight !== undefined && "strokeWeight" in node) node.strokeWeight = spec.strokeWeight;
  if (spec.cornerRadius !== undefined && "cornerRadius" in node) node.cornerRadius = spec.cornerRadius;
  if (spec.layoutMode !== undefined && "layoutMode" in node) node.layoutMode = spec.layoutMode;
  if (spec.primaryAxisSizingMode !== undefined && "primaryAxisSizingMode" in node) node.primaryAxisSizingMode = spec.primaryAxisSizingMode;
  if (spec.counterAxisSizingMode !== undefined && "counterAxisSizingMode" in node) node.counterAxisSizingMode = spec.counterAxisSizingMode;
  if (spec.primaryAxisAlignItems !== undefined && "primaryAxisAlignItems" in node) node.primaryAxisAlignItems = spec.primaryAxisAlignItems;
  if (spec.counterAxisAlignItems !== undefined && "counterAxisAlignItems" in node) node.counterAxisAlignItems = spec.counterAxisAlignItems;
  if (spec.itemSpacing !== undefined && "itemSpacing" in node) node.itemSpacing = spec.itemSpacing;
  if (spec.padding !== undefined && "paddingTop" in node) {
    const p = typeof spec.padding === "number" ? { top: spec.padding, right: spec.padding, bottom: spec.padding, left: spec.padding } : spec.padding;
    node.paddingTop = p.top ?? node.paddingTop;
    node.paddingRight = p.right ?? node.paddingRight;
    node.paddingBottom = p.bottom ?? node.paddingBottom;
    node.paddingLeft = p.left ?? node.paddingLeft;
  }
  if (spec.constraints !== undefined && "constraints" in node) node.constraints = spec.constraints;
  if (spec.text !== undefined && "characters" in node) {
    await loadFont(node);
    node.characters = spec.text;
  }
  if (spec.fontSize !== undefined && "fontSize" in node) {
    await loadFont(node);
    node.fontSize = spec.fontSize;
  }
  if (spec.componentProperties !== undefined && node.type === "INSTANCE") node.setProperties(spec.componentProperties);
  if (spec.connectorStart !== undefined && node.type === "CONNECTOR") node.connectorStart = spec.connectorStart;
  if (spec.connectorEnd !== undefined && node.type === "CONNECTOR") node.connectorEnd = spec.connectorEnd;
}

async function createNode(spec, parent) {
  let node;
  switch ((spec.type || "FRAME").toUpperCase()) {
    case "FRAME": node = figma.createFrame(); break;
    case "SECTION": node = figma.createSection(); break;
    case "RECTANGLE": node = figma.createRectangle(); break;
    case "ELLIPSE": node = figma.createEllipse(); break;
    case "LINE": node = figma.createLine(); break;
    case "TEXT": node = figma.createText(); break;
    case "COMPONENT": node = figma.createComponent(); break;
    case "INSTANCE": {
      if (spec.componentId) {
        const component = await find(spec.componentId);
        if (component.type !== "COMPONENT") throw new Error(spec.componentId + " is not a component");
        node = component.createInstance();
      } else if (spec.componentKey) {
        node = (await figma.importComponentByKeyAsync(spec.componentKey)).createInstance();
      } else throw new Error("INSTANCE requires componentId or componentKey");
      break;
    }
    case "STICKY": node = figma.createSticky(); break;
    case "SHAPE_WITH_TEXT": node = figma.createShapeWithText(); break;
    case "CONNECTOR": node = figma.createConnector(); break;
    default: throw new Error("Unsupported node type: " + spec.type);
  }
  if (parent && "appendChild" in parent) parent.appendChild(node);
  await setProps(node, spec);
  if (spec.children && "appendChild" in node) {
    for (const child of spec.children) await createNode(child, node);
  }
  return node;
}

async function execute(operation, args) {
  if (operation === "figma_read") {
    const depth = args.depth ?? 2;
    if (args.target === "document") {
      await figma.loadAllPagesAsync();
      return { editorType: figma.editorType, document: summary(figma.root, depth) };
    }
    if (args.target === "page") return { editorType: figma.editorType, page: summary(figma.currentPage, depth) };
    if (args.target === "node" || args.nodeId) return { editorType: figma.editorType, node: summary(await find(args.nodeId), depth) };
    return { editorType: figma.editorType, page: { id: figma.currentPage.id, name: figma.currentPage.name }, selection: figma.currentPage.selection.map(node => summary(node, depth)) };
  }
  if (operation === "figma_create") {
    const parent = args.parentId ? await find(args.parentId) : figma.currentPage;
    const created = [];
    for (const spec of args.nodes) created.push(await createNode(spec, parent));
    figma.currentPage.selection = created.filter(node => node.parent === figma.currentPage || node.parent);
    figma.viewport.scrollAndZoomIntoView(created);
    return { created: created.map(node => summary(node, 3)) };
  }
  if (operation === "figma_update") {
    const changed = [];
    for (const update of args.updates) {
      const node = await find(update.id);
      await setProps(node, update);
      changed.push(node);
    }
    return { updated: changed.map(node => summary(node, 2)) };
  }
  if (operation === "figma_delete") {
    for (const id of args.nodeIds) (await find(id)).remove();
    return { deleted: args.nodeIds };
  }
  if (operation === "figma_select") {
    const nodes = await Promise.all(args.nodeIds.map(find));
    const sceneNodes = nodes.filter(node => node.type !== "DOCUMENT" && node.type !== "PAGE");
    figma.currentPage.selection = sceneNodes;
    if (args.zoom !== false && sceneNodes.length) figma.viewport.scrollAndZoomIntoView(sceneNodes);
    return { selected: sceneNodes.map(node => node.id) };
  }
  if (operation === "figma_export") {
    const node = await find(args.nodeId);
    if (!("exportAsync" in node)) throw new Error("Node cannot be exported");
    const format = args.format || "PNG";
    const settings = (format === "PNG" || format === "JPG") ? { format, constraint: { type: "SCALE", value: args.scale || 1 } } : { format };
    const bytes = await node.exportAsync(settings);
    const mime = { PNG: "image/png", JPG: "image/jpeg", SVG: "image/svg+xml", PDF: "application/pdf" }[format];
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    return { __export: true, mimeType: mime, base64: btoa(binary) };
  }
  throw new Error("Unknown operation: " + operation);
}

figma.ui.onmessage = async message => {
  if (!message || message.type !== "command") return;
  const command = message.command;
  try {
    const data = await execute(command.operation, command.args || {});
    const result = data && data.__export
      ? { id: command.id, ok: true, mimeType: data.mimeType, base64: data.base64 }
      : { id: command.id, ok: true, data };
    figma.ui.postMessage({ type: "result", result });
  } catch (error) {
    figma.ui.postMessage({ type: "result", result: { id: command.id, ok: false, error: error && error.message ? error.message : String(error) } });
  }
};
