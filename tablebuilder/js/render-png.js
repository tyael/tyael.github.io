/**
 * render-png.js
 *
 * PNG export, rasterised from the SVG the vector exporter produces.
 *
 * Going through the SVG rather than screenshotting the DOM means the two
 * exports can never disagree, and it sidesteps the usual html-to-canvas
 * libraries entirely. It also forces the font question to be answered
 * properly: an `<img>` loading an SVG runs in an isolated document that will
 * not fetch external resources, so the font has to be embedded in the SVG —
 * which render-svg.js already does.
 */

const RenderPng = {

  /**
   * @param {Object} model
   * @param {Object} [opts] - {scale, background}
   * @returns {Promise<Blob>}
   */
  async build(model, opts) {
    opts = opts || {};
    const scale = Util.clamp(opts.scale || 2, 1, 12);

    // Fonts must be inlined or the raster falls back to a system face.
    const svg = await RenderSvg.build(model, { embedFonts: true });

    const image = await RenderPng.loadSvg(svg);
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    if (width * height > 268435456) {
      throw new Error('That scale would produce a ' + width + '×' + height +
        ' image, which is beyond what a canvas can hold. Try a lower scale.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // A transparent PNG is right for a table with no background of its own;
    // anything else would fight the document it gets placed into.
    const background = opts.background !== undefined
      ? opts.background
      : model.options['table.background.color'];

    if (background && background !== 'transparent') {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);
    }

    ctx.drawImage(image, 0, 0, width, height);

    return await RenderPng.toBlob(canvas);
  },

  /**
   * Load an SVG string into an Image.
   *
   * A data URI is used rather than a blob URL because Safari refuses to draw
   * blob-backed SVGs to a canvas, and the size here is well within what a data
   * URI handles.
   */
  loadSvg(svg) {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => {
        // Firefox reports 0×0 for an SVG without intrinsic dimensions; ours
        // always has width/height attributes, but guard anyway.
        if (!image.width || !image.height) {
          const match = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
          if (match) {
            image.width = Math.ceil(parseFloat(match[1]));
            image.height = Math.ceil(parseFloat(match[2]));
          }
        }
        resolve(image);
      };

      image.onerror = () => reject(new Error('The browser could not rasterise the SVG.'));

      // encodeURIComponent handles the non-ASCII that btoa would choke on.
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  },

  toBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas produced no image data.'));
      }, 'image/png');
    });
  }
};
