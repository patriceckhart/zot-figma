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

const weightStyles = {
  100: "Thin", 200: "Extra Light", 300: "Light", 400: "Regular", 500: "Medium",
  600: "Semi Bold", 700: "Bold", 800: "Extra Bold", 900: "Black"
};

const effects = values => values && values.map(value => {
  const effect = { visible: true, ...value };
  if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
    const color = typeof effect.color === "string" ? rgba(effect.color) : (effect.color || { r: 0, g: 0, b: 0 });
    effect.color = { r: color.r, g: color.g, b: color.b, a: effect.opacity ?? color.a ?? 0.25 };
    delete effect.opacity;
    effect.offset = effect.offset || { x: 0, y: 4 };
    effect.radius = effect.radius ?? 12;
    effect.spread = effect.spread ?? 0;
    effect.blendMode = effect.blendMode || "NORMAL";
  } else {
    effect.radius = effect.radius ?? 8;
  }
  return effect;
});

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
  if ("characters" in node) {
    out.text = node.characters;
    if (node.fontName !== figma.mixed) out.fontName = node.fontName;
    if (node.fontSize !== figma.mixed) out.fontSize = node.fontSize;
  }
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

// Make a child actually fill its parent's axis: auto-layout children only
// stretch when the matching sizing mode is FIXED, and text needs a fixed width.
function fillAxis(node, parentAxis) {
  const parent = node.parent;
  if (!parent || !("layoutMode" in parent) || parent.layoutMode === "NONE") return;
  const parentHorizontal = parent.layoutMode === "HORIZONTAL";
  const fillHorizontal = parentAxis === "primary" ? parentHorizontal : !parentHorizontal;
  // Reset text to its natural size first, otherwise a zero width gets frozen.
  if (node.type === "TEXT") node.textAutoResize = "WIDTH_AND_HEIGHT";
  if (fillHorizontal) {
    node.layoutSizingHorizontal = "FILL";
    if (node.type === "TEXT") node.textAutoResize = "HEIGHT";
  } else {
    node.layoutSizingVertical = "FILL";
  }
}

async function setProps(node, spec) {
  if (node.type === "TEXT") await loadFont(node);
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
  if (spec.layoutMode !== undefined && "layoutMode" in node) {
    node.layoutMode = spec.layoutMode;
    if (spec.layoutMode !== "NONE") {
      const horizontal = spec.layoutMode === "HORIZONTAL";
      node[horizontal ? "primaryAxisSizingMode" : "counterAxisSizingMode"] = spec.width !== undefined ? "FIXED" : "AUTO";
      node[horizontal ? "counterAxisSizingMode" : "primaryAxisSizingMode"] = spec.height !== undefined ? "FIXED" : "AUTO";
      if (spec.width !== undefined || spec.height !== undefined) node.resize(spec.width ?? node.width, spec.height ?? node.height);
    }
  }
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
  if (spec.effects !== undefined && "effects" in node) node.effects = effects(spec.effects);
  if (spec.strokeAlign !== undefined && "strokeAlign" in node) node.strokeAlign = spec.strokeAlign;
  if (spec.clipsContent !== undefined && "clipsContent" in node) node.clipsContent = spec.clipsContent;
  if (spec.layoutWrap !== undefined && "layoutWrap" in node) node.layoutWrap = spec.layoutWrap;
  if (spec.counterAxisSpacing !== undefined && "counterAxisSpacing" in node) node.counterAxisSpacing = spec.counterAxisSpacing;
  if (spec.layoutAlign !== undefined && "layoutAlign" in node) {
    node.layoutAlign = spec.layoutAlign;
    if (spec.layoutAlign === "STRETCH") fillAxis(node, "counter");
  }
  if (spec.layoutGrow !== undefined && "layoutGrow" in node) {
    node.layoutGrow = spec.layoutGrow;
    if (spec.layoutGrow > 0) fillAxis(node, "primary");
  }
  if (spec.layoutPositioning !== undefined && "layoutPositioning" in node) node.layoutPositioning = spec.layoutPositioning;
  if (spec.minWidth !== undefined && "minWidth" in node) node.minWidth = spec.minWidth;
  if (spec.maxWidth !== undefined && "maxWidth" in node) node.maxWidth = spec.maxWidth;
  if (spec.minHeight !== undefined && "minHeight" in node) node.minHeight = spec.minHeight;
  if (spec.maxHeight !== undefined && "maxHeight" in node) node.maxHeight = spec.maxHeight;
  if ("characters" in node) {
    if (spec.fontFamily !== undefined || spec.fontWeight !== undefined || spec.fontStyle !== undefined) {
      const current = node.fontName === figma.mixed ? { family: "Inter", style: "Regular" } : node.fontName;
      const family = spec.fontFamily || current.family;
      let style = spec.fontStyle || (spec.fontWeight !== undefined ? (weightStyles[spec.fontWeight] || String(spec.fontWeight)) : current.style);
      try {
        await figma.loadFontAsync({ family, style });
      } catch (error) {
        const fallback = style.replace(" ", "");
        await figma.loadFontAsync({ family, style: fallback });
        style = fallback;
      }
      node.fontName = { family, style };
    } else if (spec.text !== undefined || spec.fontSize !== undefined || spec.textAlignHorizontal !== undefined || spec.lineHeight !== undefined || spec.letterSpacing !== undefined) {
      await loadFont(node);
    }
    if (spec.text !== undefined) node.characters = spec.text;
    if (spec.fontSize !== undefined) node.fontSize = spec.fontSize;
    if (spec.textAlignHorizontal !== undefined) node.textAlignHorizontal = spec.textAlignHorizontal;
    if (spec.textAlignVertical !== undefined) node.textAlignVertical = spec.textAlignVertical;
    if (spec.textAutoResize !== undefined) node.textAutoResize = spec.textAutoResize;
    if (spec.lineHeight !== undefined) node.lineHeight = typeof spec.lineHeight === "number" ? { value: spec.lineHeight, unit: "PIXELS" } : spec.lineHeight;
    if (spec.letterSpacing !== undefined) node.letterSpacing = typeof spec.letterSpacing === "number" ? { value: spec.letterSpacing, unit: "PERCENT" } : spec.letterSpacing;
    if (spec.textCase !== undefined) node.textCase = spec.textCase;
    if (spec.textDecoration !== undefined) node.textDecoration = spec.textDecoration;
    if (spec.textWidth !== undefined) {
      node.textAutoResize = "HEIGHT";
      node.resize(spec.textWidth, node.height);
    }
    if (spec.layoutAlign === "STRETCH") fillAxis(node, "counter");
    if (spec.layoutGrow > 0) fillAxis(node, "primary");
    if (spec.textTruncation !== undefined) node.textTruncation = spec.textTruncation;
    if (spec.maxLines !== undefined) node.maxLines = spec.maxLines;
  }
  if (spec.parentId !== undefined || spec.index !== undefined) {
    const parent = spec.parentId !== undefined ? await find(spec.parentId) : node.parent;
    if (parent && "insertChild" in parent) {
      const index = spec.index !== undefined ? spec.index : parent.children.length;
      parent.insertChild(Math.min(index, parent.children.length), node);
    }
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

// Bulk text replacement: update.replaceText = [{ from, to }, ...]
async function replaceText(root, pairs) {
  const changed = [];
  const texts = root.type === "TEXT" ? [root] : root.findAllWithCriteria({ types: ["TEXT"] });
  for (const text of texts) {
    let value = text.characters;
    for (const pair of pairs) value = value.split(pair.from).join(pair.to);
    if (value === text.characters) continue;
    await loadFont(text);
    text.characters = value;
    if (text.name === text.characters) text.name = value;
    changed.push(text);
  }
  return changed;
}

const toHex = color => "#" + [color.r, color.g, color.b].map(c => Math.round(c * 255).toString(16).padStart(2, "0")).join("").toUpperCase();

async function getOrCreateVariable(collectionName, variableName, hex) {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  let collection = collections.find(c => c.name === collectionName);
  if (!collection) collection = figma.variables.createVariableCollection(collectionName);
  const modeId = collection.modes[0].modeId;
  const variables = await figma.variables.getLocalVariablesAsync("COLOR");
  let variable = variables.find(v => v.name === variableName && v.variableCollectionId === collection.id);
  if (!variable) variable = figma.variables.createVariable(variableName, collection, "COLOR");
  const color = rgba(hex);
  variable.setValueForMode(modeId, { r: color.r, g: color.g, b: color.b, a: 1 });
  return variable;
}

// Bind every solid fill/stroke matching a hex to a colour variable.
// update.replaceColors = { collection, map: [{ hex, variable }] }
async function replaceColors(root, spec) {
  const collectionName = spec.collection || "Brand";
  const byHex = {};
  for (const entry of spec.map) byHex[entry.hex.toUpperCase()] = await getOrCreateVariable(collectionName, entry.variable, entry.hex);
  const nodes = "findAll" in root ? [root, ...root.findAll(() => true)] : [root];
  const changed = [];
  let bound = 0;
  for (const node of nodes) {
    let touched = false;
    for (const prop of ["fills", "strokes"]) {
      if (!(prop in node) || node[prop] === figma.mixed) continue;
      const paintList = node[prop].map(paint => {
        if (paint.type !== "SOLID") return paint;
        const variable = byHex[toHex(paint.color)];
        if (!variable) return paint;
        bound++;
        touched = true;
        return figma.variables.setBoundVariableForPaint(paint, "color", variable);
      });
      if (touched) node[prop] = paintList;
    }
    if (touched) changed.push(node);
  }
  return { nodes: changed, bound };
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
      if (update.setVariables) {
        for (const entry of update.setVariables) await getOrCreateVariable(entry.collection || "inoovum Brand", entry.variable, entry.hex);
        return { variables: update.setVariables.map(v => v.variable) };
      }
      if (update.replaceText) {
        changed.push(...await replaceText(node, update.replaceText));
        continue;
      }
      if (update.replaceColors) {
        const result = await replaceColors(node, update.replaceColors);
        return { bound: result.bound, nodes: result.nodes.length, variables: update.replaceColors.map.map(m => m.variable) };
      }
      await setProps(node, update);
      changed.push(node);
    }
    return { updated: changed.map(node => summary(node, 1)) };
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
