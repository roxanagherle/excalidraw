import {
  ExcalidrawElement,
  ExcalidrawTextElement,
  NonDeletedExcalidrawElement,
} from "../element/types";
import { isTextElement } from "../element/typeChecks";
import {
  getDiamondPoints,
  getArrowPoints,
  getElementAbsoluteCoords,
} from "../element/bounds";
import { RoughCanvas } from "roughjs/bin/canvas";
import { Drawable, Options } from "roughjs/bin/core";
import { RoughSVG } from "roughjs/bin/svg";
import { RoughGenerator } from "roughjs/bin/generator";
import { SceneState } from "../scene/types";
import { SVG_NS, distance } from "../utils";
import { isPathALoop } from "../math";
import rough from "roughjs/bin/rough";

const CANVAS_PADDING = 20;

export interface ExcalidrawElementWithCanvas {
  element: ExcalidrawElement | ExcalidrawTextElement;
  canvas: HTMLCanvasElement;
  canvasZoom: number;
  canvasOffsetX: number;
  canvasOffsetY: number;
}

function generateElementCanvas(
  element: NonDeletedExcalidrawElement,
  zoom: number,
): ExcalidrawElementWithCanvas {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d")!;

  const isLinear = /\b(arrow|line)\b/.test(element.type);

  let canvasOffsetX = 0;
  let canvasOffsetY = 0;

  if (isLinear) {
    const [x1, y1, x2, y2] = getElementAbsoluteCoords(element);
    canvas.width =
      distance(x1, x2) * window.devicePixelRatio * zoom + CANVAS_PADDING * 2;
    canvas.height =
      distance(y1, y2) * window.devicePixelRatio * zoom + CANVAS_PADDING * 2;

    canvasOffsetX =
      element.x > x1
        ? Math.floor(distance(element.x, x1)) * window.devicePixelRatio
        : 0;
    canvasOffsetY =
      element.y > y1
        ? Math.floor(distance(element.y, y1)) * window.devicePixelRatio
        : 0;
    context.translate(canvasOffsetX * zoom, canvasOffsetY * zoom);
  } else {
    canvas.width =
      element.width * window.devicePixelRatio * zoom + CANVAS_PADDING * 2;
    canvas.height =
      element.height * window.devicePixelRatio * zoom + CANVAS_PADDING * 2;
  }

  context.translate(CANVAS_PADDING, CANVAS_PADDING);
  context.scale(window.devicePixelRatio * zoom, window.devicePixelRatio * zoom);

  const rc = rough.canvas(canvas);
  drawElementOnCanvas(element, rc, context);
  context.translate(-CANVAS_PADDING, -CANVAS_PADDING);
  context.scale(
    1 / (window.devicePixelRatio * zoom),
    1 / (window.devicePixelRatio * zoom),
  );
  return { element, canvas, canvasZoom: zoom, canvasOffsetX, canvasOffsetY };
}

function drawElementOnCanvas(
  element: NonDeletedExcalidrawElement,
  rc: RoughCanvas,
  context: CanvasRenderingContext2D,
) {
  context.globalAlpha = element.opacity / 100;
  switch (element.type) {
    case "rectangle":
    case "diamond":
    case "ellipse": {
      rc.draw(getShapeForElement(element) as Drawable);
      break;
    }
    case "arrow":
    case "line": {
      (getShapeForElement(element) as Drawable[]).forEach((shape) =>
        rc.draw(shape),
      );
      break;
    }
    default: {
      if (isTextElement(element)) {
        const font = context.font;
        context.font = element.font;
        const fillStyle = context.fillStyle;
        context.fillStyle = element.strokeColor;
        const textAlign = context.textAlign;
        context.textAlign = element.textAlign as CanvasTextAlign;
        // Canvas does not support multiline text by default
        const lines = element.text.replace(/\r\n?/g, "\n").split("\n");
        const lineHeight = element.height / lines.length;
        const verticalOffset = element.height - element.baseline;
        const horizontalOffset =
          element.textAlign === "center"
            ? element.width / 2
            : element.textAlign === "right"
            ? element.width
            : 0;
        for (let i = 0; i < lines.length; i++) {
          context.fillText(
            lines[i],
            0 + horizontalOffset,
            (i + 1) * lineHeight - verticalOffset,
          );
        }
        context.fillStyle = fillStyle;
        context.font = font;
        context.textAlign = textAlign;
      } else {
        throw new Error(`Unimplemented type ${element.type}`);
      }
    }
  }
  context.globalAlpha = 1;
}

const elementWithCanvasCache = new WeakMap<
  ExcalidrawElement,
  ExcalidrawElementWithCanvas
>();

const shapeCache = new WeakMap<
  ExcalidrawElement,
  Drawable | Drawable[] | null
>();

export function getShapeForElement(element: ExcalidrawElement) {
  return shapeCache.get(element);
}

export function invalidateShapeForElement(element: ExcalidrawElement) {
  shapeCache.delete(element);
}

function generateElement(
  element: NonDeletedExcalidrawElement,
  generator: RoughGenerator,
  sceneState?: SceneState,
) {
  let shape = shapeCache.get(element) || null;
  if (!shape) {
    elementWithCanvasCache.delete(element);
    switch (element.type) {
      case "rectangle":
        shape = generator.rectangle(0, 0, element.width, element.height, {
          stroke: element.strokeColor,
          fill:
            element.backgroundColor === "transparent"
              ? undefined
              : element.backgroundColor,
          fillStyle: element.fillStyle,
          strokeWidth: element.strokeWidth,
          roughness: element.roughness,
          seed: element.seed,
        });

        break;
      case "diamond": {
        const [
          topX,
          topY,
          rightX,
          rightY,
          bottomX,
          bottomY,
          leftX,
          leftY,
        ] = getDiamondPoints(element);
        shape = generator.polygon(
          [
            [topX, topY],
            [rightX, rightY],
            [bottomX, bottomY],
            [leftX, leftY],
          ],
          {
            stroke: element.strokeColor,
            fill:
              element.backgroundColor === "transparent"
                ? undefined
                : element.backgroundColor,
            fillStyle: element.fillStyle,
            strokeWidth: element.strokeWidth,
            roughness: element.roughness,
            seed: element.seed,
          },
        );
        break;
      }
      case "ellipse":
        shape = generator.ellipse(
          element.width / 2,
          element.height / 2,
          element.width,
          element.height,
          {
            stroke: element.strokeColor,
            fill:
              element.backgroundColor === "transparent"
                ? undefined
                : element.backgroundColor,
            fillStyle: element.fillStyle,
            strokeWidth: element.strokeWidth,
            roughness: element.roughness,
            seed: element.seed,
            curveFitting: 1,
          },
        );
        break;
      case "line":
      case "arrow": {
        const options: Options = {
          stroke: element.strokeColor,
          strokeWidth: element.strokeWidth,
          roughness: element.roughness,
          seed: element.seed,
        };

        // points array can be empty in the beginning, so it is important to add
        // initial position to it
        const points = element.points.length ? element.points : [[0, 0]];

        // If shape is a line and is a closed shape,
        // fill the shape if a color is set.
        if (element.type === "line") {
          if (isPathALoop(element.points)) {
            options.fillStyle = element.fillStyle;
            options.fill =
              element.backgroundColor === "transparent"
                ? undefined
                : element.backgroundColor;
          }
        }

        // curve is always the first element
        // this simplifies finding the curve for an element
        shape = [generator.curve(points as [number, number][], options)];

        // add lines only in arrow
        if (element.type === "arrow") {
          const [x2, y2, x3, y3, x4, y4] = getArrowPoints(element, shape);
          shape.push(
            ...[
              generator.line(x3, y3, x2, y2, options),
              generator.line(x4, y4, x2, y2, options),
            ],
          );
        }
        break;
      }
      case "text": {
        // just to ensure we don't regenerate element.canvas on rerenders
        shape = [];
        break;
      }
    }
    shapeCache.set(element, shape);
  }
  const zoom = sceneState ? sceneState.zoom : 1;
  const prevElementWithCanvas = elementWithCanvasCache.get(element);
  const shouldRegenerateBecauseZoom =
    prevElementWithCanvas &&
    prevElementWithCanvas.canvasZoom !== zoom &&
    !sceneState?.shouldCacheIgnoreZoom;
  if (!prevElementWithCanvas || shouldRegenerateBecauseZoom) {
    const elementWithCanvas = generateElementCanvas(element, zoom);
    elementWithCanvasCache.set(element, elementWithCanvas);
    return elementWithCanvas;
  }
  return prevElementWithCanvas;
}

function drawElementFromCanvas(
  elementWithCanvas: ExcalidrawElementWithCanvas,
  rc: RoughCanvas,
  context: CanvasRenderingContext2D,
  sceneState: SceneState,
) {
  const element = elementWithCanvas.element;
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(element);
  const cx = ((x1 + x2) / 2 + sceneState.scrollX) * window.devicePixelRatio;
  const cy = ((y1 + y2) / 2 + sceneState.scrollY) * window.devicePixelRatio;
  context.scale(1 / window.devicePixelRatio, 1 / window.devicePixelRatio);
  context.translate(cx, cy);
  context.rotate(element.angle);
  context.drawImage(
    elementWithCanvas.canvas!,
    (-(x2 - x1) / 2) * window.devicePixelRatio -
      CANVAS_PADDING / elementWithCanvas.canvasZoom,
    (-(y2 - y1) / 2) * window.devicePixelRatio -
      CANVAS_PADDING / elementWithCanvas.canvasZoom,
    elementWithCanvas.canvas!.width / elementWithCanvas.canvasZoom,
    elementWithCanvas.canvas!.height / elementWithCanvas.canvasZoom,
  );
  context.rotate(-element.angle);
  context.translate(-cx, -cy);
  context.scale(window.devicePixelRatio, window.devicePixelRatio);
}

export function renderElement(
  element: NonDeletedExcalidrawElement,
  rc: RoughCanvas,
  context: CanvasRenderingContext2D,
  renderOptimizations: boolean,
  sceneState: SceneState,
) {
  const generator = rc.generator;
  switch (element.type) {
    case "selection": {
      context.translate(
        element.x + sceneState.scrollX,
        element.y + sceneState.scrollY,
      );
      const fillStyle = context.fillStyle;
      context.fillStyle = "rgba(0, 0, 255, 0.10)";
      context.fillRect(0, 0, element.width, element.height);
      context.fillStyle = fillStyle;
      context.translate(
        -element.x - sceneState.scrollX,
        -element.y - sceneState.scrollY,
      );
      break;
    }
    case "rectangle":
    case "diamond":
    case "ellipse":
    case "line":
    case "arrow":
    case "text": {
      const elementWithCanvas = generateElement(element, generator, sceneState);

      if (renderOptimizations) {
        drawElementFromCanvas(elementWithCanvas, rc, context, sceneState);
      } else {
        const [x1, y1, x2, y2] = getElementAbsoluteCoords(element);
        const cx = (x1 + x2) / 2 + sceneState.scrollX;
        const cy = (y1 + y2) / 2 + sceneState.scrollY;
        const shiftX = (x2 - x1) / 2 - (element.x - x1);
        const shiftY = (y2 - y1) / 2 - (element.y - y1);
        context.translate(cx, cy);
        context.rotate(element.angle);
        context.translate(-shiftX, -shiftY);
        drawElementOnCanvas(element, rc, context);
        context.translate(shiftX, shiftY);
        context.rotate(-element.angle);
        context.translate(-cx, -cy);
      }
      break;
    }
    default: {
      // @ts-ignore
      throw new Error(`Unimplemented type ${element.type}`);
    }
  }
}

export function renderElementToSvg(
  element: NonDeletedExcalidrawElement,
  rsvg: RoughSVG,
  svgRoot: SVGElement,
  offsetX?: number,
  offsetY?: number,
) {
  const [x1, y1, x2, y2] = getElementAbsoluteCoords(element);
  const cx = (x2 - x1) / 2 - (element.x - x1);
  const cy = (y2 - y1) / 2 - (element.y - y1);
  const degree = (180 * element.angle) / Math.PI;
  const generator = rsvg.generator;
  switch (element.type) {
    case "selection": {
      // Since this is used only during editing experience, which is canvas based,
      // this should not happen
      throw new Error("Selection rendering is not supported for SVG");
    }
    case "rectangle":
    case "diamond":
    case "ellipse": {
      generateElement(element, generator);
      const node = rsvg.draw(getShapeForElement(element) as Drawable);
      const opacity = element.opacity / 100;
      if (opacity !== 1) {
        node.setAttribute("stroke-opacity", `${opacity}`);
        node.setAttribute("fill-opacity", `${opacity}`);
      }
      node.setAttribute(
        "transform",
        `translate(${offsetX || 0} ${
          offsetY || 0
        }) rotate(${degree} ${cx} ${cy})`,
      );
      svgRoot.appendChild(node);
      break;
    }
    case "line":
    case "arrow": {
      generateElement(element, generator);
      const group = svgRoot.ownerDocument!.createElementNS(SVG_NS, "g");
      const opacity = element.opacity / 100;
      (getShapeForElement(element) as Drawable[]).forEach((shape) => {
        const node = rsvg.draw(shape);
        if (opacity !== 1) {
          node.setAttribute("stroke-opacity", `${opacity}`);
          node.setAttribute("fill-opacity", `${opacity}`);
        }
        node.setAttribute(
          "transform",
          `translate(${offsetX || 0} ${
            offsetY || 0
          }) rotate(${degree} ${cx} ${cy})`,
        );
        group.appendChild(node);
      });
      svgRoot.appendChild(group);
      break;
    }
    default: {
      if (isTextElement(element)) {
        const opacity = element.opacity / 100;
        const node = svgRoot.ownerDocument!.createElementNS(SVG_NS, "g");
        if (opacity !== 1) {
          node.setAttribute("stroke-opacity", `${opacity}`);
          node.setAttribute("fill-opacity", `${opacity}`);
        }
        node.setAttribute(
          "transform",
          `translate(${offsetX || 0} ${
            offsetY || 0
          }) rotate(${degree} ${cx} ${cy})`,
        );
        const lines = element.text.replace(/\r\n?/g, "\n").split("\n");
        const lineHeight = element.height / lines.length;
        const verticalOffset = element.height - element.baseline;
        const horizontalOffset =
          element.textAlign === "center"
            ? element.width / 2
            : element.textAlign === "right"
            ? element.width
            : 0;
        const fontSplit = element.font.split(" ").filter((d) => !!d.trim());
        let fontFamily = fontSplit[0];
        let fontSize = "20px";
        if (fontSplit.length > 1) {
          fontFamily = fontSplit[1];
          fontSize = fontSplit[0];
        }
        const textAnchor =
          element.textAlign === "center"
            ? "middle"
            : element.textAlign === "right"
            ? "end"
            : "start";
        for (let i = 0; i < lines.length; i++) {
          const text = svgRoot.ownerDocument!.createElementNS(SVG_NS, "text");
          text.textContent = lines[i];
          text.setAttribute("x", `${horizontalOffset}`);
          text.setAttribute("y", `${(i + 1) * lineHeight - verticalOffset}`);
          text.setAttribute("font-family", fontFamily);
          text.setAttribute("font-size", fontSize);
          text.setAttribute("fill", element.strokeColor);
          text.setAttribute("text-anchor", textAnchor);
          node.appendChild(text);
        }
        svgRoot.appendChild(node);
      } else {
        // @ts-ignore
        throw new Error(`Unimplemented type ${element.type}`);
      }
    }
  }
}
