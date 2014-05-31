/**
 * Copyright 2014 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
module Shumway.GFX {
  import Point = Geometry.Point;
  import Rectangle = Geometry.Rectangle;
  import PathCommand = Geometry.PathCommand;
  import DataBuffer = Shumway.ArrayUtilities.DataBuffer;
  import swap32 = Shumway.IntegerUtilities.swap32;
  import memorySizeToString = Shumway.StringUtilities.memorySizeToString;

  export enum RenderableFlags {
    None          = 0,

    /**
     * Whether source has dynamic content.
     */
    Dynamic       = 1,

    /**
     * Whether the source's dynamic content has changed. This is only defined if |isDynamic| is true.
     */
    Dirty         = 2,

    /**
     * Whether the source's content can be scaled and drawn at a higher resolution.
     */
    Scalable      = 4,

    /**
     * Whether the source's content should be tiled.
     */
    Tileable      = 8
  }

  /**
   * Represents some source renderable content.
   */
  export class Renderable {
    /**
     * Flags
     */
    _flags: RenderableFlags = RenderableFlags.None;

    setFlags(flags: RenderableFlags) {
      this._flags |= flags;
    }

    hasFlags(flags: RenderableFlags): boolean {
      return (this._flags & flags) === flags;
    }

    removeFlags(flags: RenderableFlags) {
      this._flags &= ~flags;
    }

    /**
     * Property bag used to attach dynamic properties to this object.
     */
    properties: {[name: string]: any} = {};

    _bounds: Rectangle;

    constructor(bounds: Rectangle) {
      this._bounds = bounds.clone();
    }

    /**
     * Bounds of the source content. This should never change.
     */
    getBounds (): Rectangle {
      return this._bounds;
    }

    /**
     * Render source content.
     */
    render(context: CanvasRenderingContext2D, clipBounds?: Shumway.GFX.Geometry.Rectangle): void {

    }
  }

  export class CustomRenderable extends Renderable {
    constructor(bounds: Rectangle, render: (context: CanvasRenderingContext2D, clipBounds: Shumway.GFX.Geometry.Rectangle) => void) {
      super(bounds);
      this.render = render;
    }
  }

  export class RenderableBitmap extends Renderable {
    _flags = RenderableFlags.Dynamic | RenderableFlags.Dirty;
    properties: {[name: string]: any} = {};
    _canvas: HTMLCanvasElement;
    private fillStyle: ColorStyle;

    public static convertImage(sourceFormat: ImageType, targetFormat: ImageType, buffer: Uint32Array) {
      if (sourceFormat === targetFormat) {
        return;
      }
      var timelineDetails = "convertImage: " + ImageType[sourceFormat] + " to " + ImageType[targetFormat] + " (" + memorySizeToString(buffer.length) + ")";
      enterTimeline(timelineDetails);
      if (sourceFormat === ImageType.PremultipliedAlphaARGB &&
          targetFormat === ImageType.StraightAlphaRGBA) {
        var length = buffer.length;
        for (var i = 0; i < length; i++) {
          var bgra = buffer[i];
          var a = (bgra >>  0) & 0xff;
          var r = (bgra >>  8) & 0xff;
          var g = (bgra >> 16) & 0xff;
          var b = (bgra >> 24) & 0xff;
          if (a > 0) {
            r = Math.imul(255, r) / a & 0xff;
            g = Math.imul(255, g) / a & 0xff;
            b = Math.imul(255, b) / a & 0xff;
          }
          var abgr = a << 24 | b << 16 | g << 8 | r;
          buffer[i] = abgr;
        }
      } else if (sourceFormat === ImageType.StraightAlphaARGB &&
                 targetFormat === ImageType.StraightAlphaRGBA) {
        for (var i = 0; i < length; i++) {
          buffer[i] = swap32(buffer[i]);
        }
      } else {
        notImplemented("Image Format Conversion: " + ImageType[sourceFormat] + " -> " + ImageType[targetFormat]);
      }
      leaveTimeline(timelineDetails);
    }

    public static FromDataBuffer(type: ImageType, dataBuffer: DataBuffer, bounds: Rectangle): RenderableBitmap {
      enterTimeline("RenderableBitmap.FromDataBuffer");
      var canvas = document.createElement("canvas");
      canvas.width = bounds.w;
      canvas.height = bounds.h;
      var context = canvas.getContext("2d");
      var imageData: ImageData = context.createImageData(bounds.w, bounds.h);

      RenderableBitmap.convertImage (
        type,
        ImageType.StraightAlphaRGBA,
        new Uint32Array(dataBuffer.buffer)
      );

      // TODO: Pass this buffer to convert image, no need to create a new one temporarily.
      enterTimeline("setData");
      imageData.data.set(dataBuffer.bytes);
      leaveTimeline("setData");

      enterTimeline("putImageData");
      context.putImageData(imageData, 0, 0);
      leaveTimeline("putImageData");

      var renderableBitmap = new RenderableBitmap(canvas, bounds);
      leaveTimeline("RenderableBitmap.FromDataBuffer");
      return renderableBitmap;
    }

    public updateFromDataBuffer(type: ImageType, dataBuffer: DataBuffer) {
      enterTimeline("RenderableBitmap.updateFromDataBuffer");
      var context = this._canvas.getContext("2d");
      var imageData: ImageData = context.createImageData(this._bounds.w, this._bounds.h);

      RenderableBitmap.convertImage (
        type,
        ImageType.StraightAlphaRGBA,
        new Uint32Array(dataBuffer.buffer)
      );

      imageData.data.set(dataBuffer.bytes);
      context.putImageData(imageData, 0, 0);
      this.setFlags(RenderableFlags.Dirty);
      leaveTimeline("RenderableBitmap.updateFromDataBuffer");
    }

    constructor(canvas: HTMLCanvasElement, bounds: Rectangle) {
      super(bounds);
      this._canvas = canvas;
    }

    render(context: CanvasRenderingContext2D, clipBounds: Rectangle): void {
      context.save();
      if (this._canvas) {
        context.drawImage(this._canvas, 0, 0);
      } else {
        this._renderFallback(context);
      }
      context.restore();
    }

    private _renderFallback(context: CanvasRenderingContext2D) {
      if (!this.fillStyle) {
        this.fillStyle = Shumway.ColorStyle.randomStyle();
      }
      var bounds = this._bounds;
      context.save();
      context.beginPath();
      context.lineWidth = 2;
      context.fillStyle = this.fillStyle;
      context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
      context.restore();
    }

    public getContext(): CanvasRenderingContext2D {
      return this._canvas.getContext('2d');
    }
  }

  export class RenderableShape extends Renderable {
    _flags: RenderableFlags = RenderableFlags.Dirty | RenderableFlags.Scalable | RenderableFlags.Tileable;
    properties: {[name: string]: any} = {};

    private fillStyle: ColorStyle;
    private _pathData: DataBuffer;
    private _assets: Renderable[];

    private static LINE_CAP_STYLES = ['round', 'butt', 'square'];
    private static LINE_JOINT_STYLES = ['round', 'bevel', 'miter'];

    constructor(pathData: DataBuffer, assets: Renderable[], bounds: Rectangle) {
      super(bounds);
      this._pathData = pathData;
      this._assets = assets;
    }

    getBounds(): Shumway.GFX.Geometry.Rectangle {
      return this._bounds;
    }

    render(context: CanvasRenderingContext2D, clipBounds: Rectangle): void {
      context.save();
      context.fillRule = context.mozFillRule = "evenodd";

      var data = this._pathData;
      if (!data || data.length === 0) {
        this._renderFallback(context);
        return;
      }
      enterTimeline("RenderableShape.render");
      // TODO: Optimize path handling to use only one path if possible.
      // If both line and fill style are set at the same time, we don't need to duplicate the
      // geometry.
      // TODO: correctly handle style changes.
      // Flash allows switching line and fill styles at arbitrary points, so you can have a
      // shape with a single fill but varying line styles. In that case, it's necessary to
      // delay stroking of the lines until the fill is finished. Probably by pushing all
      // stroke paths onto a stack.
      var fillPath = null;
      var strokePath = null;
      data.position = 0;
      // We have to alway store the last position because Flash keeps the drawing cursor where it
      // was when changing fill or line style, whereas Canvas forgets it on beginning a new path.
      var x = 0;
      var y = 0;
      var cpX: number;
      var cpY: number;
      // Description of serialization format can be found in flash.display.Graphics.
      while (data.bytesAvailable > 0) {
        var command = data.readUnsignedByte();
        switch (command) {
          case PathCommand.MoveTo:
            assert(data.bytesAvailable >= 8);
            x = data.readInt() / 20;
            y = data.readInt() / 20;
            fillPath && fillPath.moveTo(x, y);
            strokePath && strokePath.moveTo(x, y);
            break;
          case PathCommand.LineTo:
            assert(data.bytesAvailable >= 8);
            x = data.readInt() / 20;
            y = data.readInt() / 20;
            fillPath && fillPath.lineTo(x, y);
            strokePath && strokePath.lineTo(x, y);
            break;
          case PathCommand.CurveTo:
            assert(data.bytesAvailable >= 16);
            cpX = data.readInt() / 20;
            cpY = data.readInt() / 20;
            x = data.readInt() / 20;
            y = data.readInt() / 20;
            fillPath && fillPath.quadraticCurveTo(cpX, cpY, x, y);
            strokePath && strokePath.quadraticCurveTo(cpX, cpY, x, y);
            break;
          case PathCommand.CubicCurveTo:
            assert(data.bytesAvailable >= 24);
            cpX = data.readInt() / 20;
            cpY = data.readInt() / 20;
            var cpX2 = data.readInt() / 20;
            var cpY2 = data.readInt() / 20;
            x = data.readInt() / 20;
            y = data.readInt() / 20;
            fillPath && fillPath.bezierCurveTo(cpX, cpY, cpX2, cpY2, x, y);
            strokePath && strokePath.bezierCurveTo(cpX, cpY, cpX2, cpY2, x, y);
            break;
          case PathCommand.BeginSolidFill:
            assert(data.bytesAvailable >= 4);
            if (fillPath) {
              context.fill(fillPath);
            }
            fillPath = new Path2D();
            fillPath.moveTo(x, y);
            var color = data.readUnsignedInt();
            context.fillStyle = ColorUtilities.rgbaToCSSStyle(color);
            break;
          case PathCommand.BeginBitmapFill:
            assert(data.bytesAvailable >= 6 + 6 * 8 /* matrix fields as floats */ + 1 + 1);
            if (fillPath) {
              context.fill(fillPath);
            }
            fillPath = new Path2D();
            fillPath.moveTo(x, y);
            var textureId = data.readUnsignedInt();
            // Skip matrix for now.
            data.readFloat();
            data.readFloat();
            data.readFloat();
            data.readFloat();
            data.readFloat();
            data.readFloat();
            var repeat = data.readBoolean() ? 'repeat' : 'no-repeat';
            var smooth = data.readBoolean();
            var texture = <RenderableBitmap>this._assets[textureId];
            assert(texture._canvas);
            context.fillStyle = context.createPattern(texture._canvas, repeat);
            break;
          case PathCommand.EndFill:
            if (fillPath) {
              context.fill(fillPath);
              context.fillStyle = null;
              fillPath = null;
            }
            break;
          case PathCommand.LineStyleSolid:
            if (strokePath) {
              context.stroke(strokePath);
            }
            strokePath = new Path2D();
            strokePath.moveTo(x, y);
            context.lineWidth = data.readUnsignedByte();
            context.strokeStyle = ColorUtilities.rgbaToCSSStyle(data.readUnsignedInt());
            data.readBoolean(); // Skip pixel hinting.
            data.readByte(); // Skip scaleMode.
            context.lineCap = RenderableShape.LINE_CAP_STYLES[data.readByte()];
            context.lineJoin = RenderableShape.LINE_JOINT_STYLES[data.readByte()];
            context.miterLimit = data.readByte();
            break;
          case PathCommand.LineEnd:
            if (strokePath) {
              context.stroke(strokePath);
              context.strokeStyle = null;
              strokePath = null;
            }
        }
      }
      if (fillPath) {
        context.fill(fillPath);
        context.fillStyle = null;
      }
      if (strokePath) {
        context.stroke(strokePath);
        context.strokeStyle = null;
      }
      context.restore();
      leaveTimeline("RenderableShape.render");
    }

    private _renderFallback(context: CanvasRenderingContext2D) {
      if (!this.fillStyle) {
        this.fillStyle = Shumway.ColorStyle.randomStyle();
      }
      var bounds = this._bounds;
      context.save();
      context.beginPath();
      context.lineWidth = 2;
      context.fillStyle = this.fillStyle;
      context.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
//      context.textBaseline = "top";
//      context.fillStyle = "white";
//      context.fillText(String(id), bounds.x, bounds.y);
      context.restore();
    }

  }

  export class Label extends Renderable {
    _flags: RenderableFlags = RenderableFlags.Dynamic | RenderableFlags.Scalable;
    properties: {[name: string]: any} = {};
    private _text: string;

    get text (): string {
      return this._text;
    }

    set text (value: string) {
      this._text = value;
    }

    constructor(w: number, h: number) {
      super(new Rectangle(0, 0, w, h));
    }

    render (context: CanvasRenderingContext2D, clipBounds?: Rectangle) {
      context.save();
      context.textBaseline = "top";
      context.fillStyle = "white";
      context.fillText(this.text, 0, 0);
      context.restore();
    }
  }

  export class Grid extends Renderable {
    _flags: RenderableFlags = RenderableFlags.Dirty | RenderableFlags.Scalable | RenderableFlags.Tileable;
    properties: {[name: string]: any} = {};

    constructor() {
      super(Rectangle.createMaxI16());
    }

    render (context: CanvasRenderingContext2D, clipBounds?: Rectangle) {
      context.save();

      var gridBounds = clipBounds || this.getBounds();

      context.fillStyle = ColorStyle.VeryDark;
      context.fillRect(gridBounds.x, gridBounds.y, gridBounds.w, gridBounds.h);

      function gridPath(level) {
        var vStart = Math.floor(gridBounds.x / level) * level;
        var vEnd   = Math.ceil((gridBounds.x + gridBounds.w) / level) * level;

        for (var x = vStart; x < vEnd; x += level) {
          context.moveTo(x + 0.5, gridBounds.y);
          context.lineTo(x + 0.5, gridBounds.y + gridBounds.h);
        }

        var hStart = Math.floor(gridBounds.y / level) * level;
        var hEnd   = Math.ceil((gridBounds.y + gridBounds.h) / level) * level;

        for (var y = hStart; y < hEnd; y += level) {
          context.moveTo(gridBounds.x, y + 0.5);
          context.lineTo(gridBounds.x + gridBounds.w, y + 0.5);
        }
      }

      context.beginPath();
      gridPath(100);
      context.lineWidth = 1;
      context.strokeStyle = ColorStyle.Dark;
      context.stroke();

      context.beginPath();
      gridPath(500);
      context.lineWidth = 1;
      context.strokeStyle = ColorStyle.TabToolbar;
      context.stroke();

      context.beginPath();
      gridPath(1000);
      context.lineWidth = 3;
      context.strokeStyle = ColorStyle.Toolbars;
      context.stroke();

      var MAX = 1024 * 1024;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(-MAX, 0.5);
      context.lineTo(MAX , 0.5);
      context.moveTo(0.5, -MAX);
      context.lineTo(0.5, MAX);
      context.strokeStyle = ColorStyle.Orange;
      context.stroke();

      context.restore();
    }
  }
}
