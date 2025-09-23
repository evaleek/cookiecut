export const supported = () => typeof WebGL2RenderingContext !== 'undefined';

// https://stackoverflow.com/a/59739538
const fullscreenQuadVertexSource = `
out vec2 texCoord;
void main() {
    const vec2 vertices[3] = vec2[3](vec2(-1, -1), vec2(3,-1), vec2(-1, 3));
    gl_Position = vec4(vertices[gl_VertexID], 0, 1);
    texCoord = 0.5 * gl_Position.xy + vec2(0.5);
}
`;

const fullscreenTextureFragmentSource = `
    precision highp float;
    in vec2 texCoord;
    uniform sampler2D image;
    out vec4 outColor;
    void main() {
        outColor = texture(image, texCoord);
    }
`;

const sobelFragmentSource = `
    precision highp float;
    in vec2 texCoord;
    uniform sampler2D image;
    uniform vec2 pixelSize;
    out vec4 outColor;
    vec2 sobel(sampler2D tex, vec2 coord, vec2 pixel) {
        const float sqrt3 = sqrt(3.0);
        float tl = length(texture(tex, coord+pixel*vec2(-1,-1)).rgb)/sqrt3;
        float tc = length(texture(tex, coord+pixel*vec2( 0,-1)).rgb)/sqrt3;
        float tr = length(texture(tex, coord+pixel*vec2( 1,-1)).rgb)/sqrt3;
        float cl = length(texture(tex, coord+pixel*vec2(-1, 0)).rgb)/sqrt3;
        float cr = length(texture(tex, coord+pixel*vec2( 1, 0)).rgb)/sqrt3;
        float bl = length(texture(tex, coord+pixel*vec2(-1, 1)).rgb)/sqrt3;
        float bc = length(texture(tex, coord+pixel*vec2( 0, 1)).rgb)/sqrt3;
        float br = length(texture(tex, coord+pixel*vec2( 1, 1)).rgb)/sqrt3;
        float gx = -tl - 2.0*cl - bl + tr + 2.0*cr + br;
        float gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
        return vec2(gx, gy);
    }
    void main() {
        vec2 gradient = sobel(image, texCoord, pixelSize);
        outColor = vec4(gradient, length(gradient)/sqrt(2.0), 1);
    }
`;

const dctFragmentSource = (cellWidth, cellHeight) => `
    precision highp float;
    in vec2 texCoord;
    uniform sampler2D image;
    const vec2 cellPixelSize = vec2(${cellWidth}, ${cellHeight});
    uniform vec2 pixelSize;
    uniform vec2 cellSize;
    out vec4 outColor;
    void main() {
        vec2 screenCoord = vec2(texCoord.x, 1.0-texCoord.y);
        vec2 cell = floor(screenCoord/cellSize);
        vec2 cellBase = cell*cellSize;
        vec2 freqUV = floor((screenCoord-cellBase)/pixelSize);
        float dct = 0.0;
        for (float cellPixelX = 0.0; cellPixelX < cellPixelSize.x; cellPixelX += 1.0) {
            for (float cellPixelY = 0.0; cellPixelY < cellPixelSize.y; cellPixelY += 1.0) {
                vec2 cellPixel = vec2(cellPixelX, cellPixelY);
                vec2 pixelScreenCoord = cellPixel*pixelSize+cellBase;
                vec4 pixel = texture(image, vec2(pixelScreenCoord.x, 1.0-pixelScreenCoord.y));
                float pixelValue = length(pixel.rgb)*(1.0/sqrt(3.0))*pixel.a;
                pixelValue -= 0.5;
                vec2 cosine = cos( ((2.0*cellPixel+1.0)*freqUV*3.14159265358979323846)
                                  / (2.0*cellPixelSize) );
                dct += pixelValue*cosine.x*cosine.y;
            }
        }
        dct /= 0.25*cellPixelSize.x*cellPixelSize.y;
        dct += 0.5;
        outColor = vec4(dct, 0, 0, 1);
    }
`;

// Below ~6px, all glyphs look too similar.
export const glyphPxMinimum = 6;

const defaultMaskEpsilon = 0.06;

const isPositiveInteger = (val) => ( val>0 && Number.isInteger(val) );

export const isCellSize = (cellSize) => (
    cellSize.length && cellSize.length >= 2 &&
    isPositiveInteger(cellSize[0]) && isPositiveInteger(cellSize[1])
);

export const colorDistance = (a, b) => Math.hypot(...(a.map((aC, i) => aC - b[i])));

export const dctGradientDistance = (a, b) => {
    const maxRow = a.length - 1;
    const maxColumn = a[0].length - 1;
    const maxIdx = maxRow + maxColumn + 1;
    // +1 because we want to count even the farthest entry a little bit

    return a.map((row, rowIdx) => row.map((x, colIdx) =>
        (1-( (rowIdx+colIdx) / maxIdx )) * Math.abs(b[rowIdx][colIdx] - x) ))
        .reduce((x, y) => x + y);
}

export const dctLowFreqDistance = (a, b) => {
    const rows = Math.round(a.length*0.5);
    const columns = Math.round(a[0].length*0.5);

    const lowFreqA = a.map((row) => row.slice(0, columns+1)).slice(0, rows+1);
    const lowFreqB = b.map((row) => row.slice(0, columns+1)).slice(0, rows+1);

    return a.map((row, rowIdx) => row.map((x, colIdx) =>
        Math.abs(b[rowIdx][colIdx] - x))).reduce((x, y) => x+y);
};

export function Context(canvas, cellSizes) {
    this.gl = (canvas ?? document.createElement("canvas")).getContext("webgl2");
    if (!this.gl) throw new Error("could not initialize WebGL 2");

    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, true);
    this.gl.clearColor(0, 0, 0, 0);

    this.redrawProgram = compileShaders(this.gl,
        fullscreenQuadVertexSource,
        fullscreenTextureFragmentSource
    );

    this.sobelProgram = compileShaders(this.gl,
        fullscreenQuadVertexSource,
        sobelFragmentSource
    );

    this.dctPrograms = new Map(cellSizes?.map((cellSize) => {
        if (isCellSize(cellSize)) {
            return [cellSize.join(), compileShaders(this.gl,
                fullscreenQuadVertexSource,
                dctFragmentSource(cellSize[0], cellSize[1])
            )];
        } else {
            console.warn("unexpected cell size value: " + cellSize);
            return undefined;
        }
    }));

    this.addCellSize = function (cellSize) {
        if (isCellSize(cellSize)) {
            const key = cellSize.join();
            if (!this.dctPrograms.has(key)) {
                this.dctPrograms.set(key, compileShaders(this.gl,
                    fullscreenQuadVertexSource,
                    dctFragmentSource(cellSize[0], cellSize[1])
                ));
            } else {
                console.warn("redundant cell size add: " + cellSize);
            }
        } else {
            console.warn("unexpected cell size value: " + cellSize);
        }
    };

    this.clearDctPrograms = function (cellSizes) {
        if (cellSizes) {
            for (const cellSize of cellSizes) {
                if (!this.dctPrograms.delete(cellSize.join())) {
                    console.warn(`cell size ${cellSize} did not exist to be cleared from the DCT shader cache`);
                }
            }
        } else {
            this.dctPrograms.clear();
        }
    };

    this.useDctProgram = function (cellSize) {
        const key = cellSize.join();
        const program = this.dctPrograms.get(key);
        if (program) {
            this.gl.useProgram(program);
        } else {
            const w = cellSize[0];
            const h = cellSize[1];
            console.log(`building uncached shader for DCT block size (${w},${h})`);
            const newProgram = compileShaders(this.gl,
                fullscreenQuadVertexSource,
                dctFragmentSource(w, h)
            );
            this.dctPrograms.set(key, newProgram);
            this.gl.useProgram(newProgram);
        }
    };

    this.drawFrame = () => {
        this.gl.clear(this.gl.COLOR_BUFFER_BIT);
        this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    };

    this.imageSizeLimit = Math.min(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE),
                                   this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS));
}

export function ProcessingBuffer(gl, cellSize, cellCount, enabled) {
    if (!isCellSize(cellSize))
        throw new Error("unexpected cell size value: " + cellSize);
    this.cellSize = cellSize;

    this.width = cellSize[0] * cellCount[0];
    this.height = cellSize[1] * cellCount[1];

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height,
        0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    this.framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D, this.texture, 0);

    this.enabled = enabled;
    if (enabled) {
        gl.viewport(0, 0, this.width, this.height);
    } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.enable = () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
        gl.viewport(0, 0, this.width, this.height);
        this.enabled = true;
    }
    this.disable = () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.enabled = false;
    }

    this.readCells = function (mapPixel) {
        let pixelBuffer = new Uint8Array(this.width*this.height*4);
        gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuffer);
        return new Array(cellCount[1]).fill()
            .map((_, gridRow) => new Array(cellCount[0]).fill()
            .map((_, gridColumn) => new Array(cellSize[1]).fill()
            .map((_, cellRow) => new Array(cellSize[0]).fill()
            .map((_, cellColumn) => {
                const pixelRowCellBase = cellCount[1]-gridRow-1;
                const pixelRowCellOffset = cellSize[1]-cellRow-1;
                const pixelRow = (pixelRowCellBase * cellSize[1])
                                 + pixelRowCellOffset;
                const pixelColumn = gridColumn * cellSize[0] + cellColumn;
                const index = (pixelRow * this.width + pixelColumn) * 4;
                const pixel = pixelBuffer.slice(index, index+4);
                return mapPixel ? mapPixel(pixel) : pixel;
        }))));
    };
}

export const cellSizeConstant = 8;

export function Image(context, img, cellCount) {
    const gl = context.gl;

    this.cellCount = cellCount;
    const cellAspect = (img.naturalWidth/this.cellCount[0])
                     / (img.naturalHeight/this.cellCount[1]);
    this.cellSize = (cellAspect>=1.0)
        ? [ Math.round(cellSizeConstant*cellAspect), cellSizeConstant ]
        : [ cellSizeConstant, Math.round(cellSizeConstant/cellAspect) ];
    const scaledWidth = this.cellSize[0]*this.cellCount[0];
    const scaledHeight = this.cellSize[1]*this.cellCount[1];

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, scaledWidth, scaledHeight,
        0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D, this.texture, 0);

    gl.viewport(0, 0, scaledWidth, scaledHeight);

    const originTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, originTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

    gl.useProgram(context.redrawProgram);
    context.drawFrame();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
}

export function FullImage(context, img) {
    const gl = context.gl;

    this.size = [img.naturalWidth, img.naturalHeight];

    const sizeLimit = context.imageSizeLimit;
    this.textureSizeClipped = this.size.map[0] > sizeLimit ||
                              this.size.map[1] > sizeLimit;
    if (this.textureSizeClipped) {
        const overScale = Math.max(...(this.size.map((l) => l/sizeLimit)));
        this.size = this.size.map((l) => Math.floor(l/overScale));
        img = img.clone();
        img.width = this.size[0];
        img.height = this.size[1];
    }

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.bindTexture(gl.TEXTURE_2D, null);
}

export function pixelMean(pixels) {
    const premult = pixels
        .map((pixel) => [pixel[0]*pixel[3],
                         pixel[1]*pixel[3],
                         pixel[2]*pixel[3],
                         pixel[3]])
        .reduce((a, b) => a.map((aC, i) => aC + b[i]))
        .map((component) => component / pixels.length);
    return (premult[3] > 0) ? [
        premult[0] / premult[3],
        premult[1] / premult[3],
        premult[2] / premult[3],
        premult[3]
    ] : [0, 0, 0, 0];
}

export function computeCellMeans(context, processingBuffer, image, masks, maskEpsilon) {
    if (!processingBuffer.enabled) processingBuffer.enable();
    context.gl.bindTexture(context.gl.TEXTURE_2D, image.texture);
    context.gl.useProgram(context.redrawProgram);
    context.drawFrame();

    const epsilon = maskEpsilon ?? defaultMaskEpsilon;
    const maskPixel = masks ? ( (pixel) => {
        const rgb = pixel.slice(0, 3);
        return (masks.some((mask) => colorDistance(rgb, mask) < epsilon))
            ? null
            : pixel;
    }) : (pixel) => pixel;

    const pixels = processingBuffer.readCells(
        (pixel) => maskPixel(Array.from(pixel, (x) => x/255)));
    const means = pixels.map((row) => row.map((cell) => {
        const flat = cell.flat(1);
        const flatPixels = flat.filter((p) => p); // only-non-null
        if (flatPixels.length == 0) return [0, 0, 0, 0];
        const premultipliedAlphaMean = flatPixels
            .map((pixel) => [pixel[0]*pixel[3],
                             pixel[1]*pixel[3],
                             pixel[2]*pixel[3],
                             pixel[3]])
            .reduce((a, b) => a.map((aC, i) => aC + b[i]))
            .map((component) => component / pixels.length);
        if (premultipliedAlphaMean[3] > 0) {
            const r = premultipliedAlphaMean[0] / premultipliedAlphaMean[3];
            const g = premultipliedAlphaMean[1] / premultipliedAlphaMean[3];
            const b = premultipliedAlphaMean[2] / premultipliedAlphaMean[3];
            // Include nulls in alpha value
            const a = ( flat.map((pixel) => pixel ? pixel[3] : 0)
                            .reduce((a, b) => a + b) ) / flat.length;
            return [r, g, b, a];
        } else {
            return [0, 0, 0, 0];
        }
    }));

    return means;
}

export function computeImageSobel(context, processingBuffer, image) {
    if (!processingBuffer.enabled) processingBuffer.enable();
    context.gl.bindTexture(context.gl.TEXTURE_2D, image.texture);
    context.gl.useProgram(context.sobelProgram);
    context.gl.uniform2f(context.gl.getUniformLocation(context.sobelProgram, "pixelSize"),
        1 / processingBuffer.width, 1 / processingBuffer.height);
    context.drawFrame();
    const sqrt2 = Math.sqrt(2);
    return processingBuffer.readCells((pixel) => ({
        gradient: [pixel[0]/255, pixel[1]/255],
        magnitude: (pixel[2]/255)*sqrt2
    }));
}

export function computeImageDct(context, image) {
    const buffer = new ProcessingBuffer(context.gl, image.cellSize, image.cellCount, true);
    context.gl.bindTexture(context.gl.TEXTURE_2D, image.texture);
    context.useDctProgram(image.cellSize);
    const program = context.dctPrograms.get(buffer.cellSize.join());
    context.gl.uniform2f(context.gl.getUniformLocation(program, "pixelSize"),
        1 / buffer.width, 1 / buffer.height);
    context.gl.uniform2f(context.gl.getUniformLocation(program, "cellSize"),
        buffer.cellSize[0] / buffer.width, buffer.cellSize[1] / buffer.height);
    context.drawFrame();
    return buffer.readCells((pixel) => (pixel[0]/255)*2.0-1.0);
}

export function computeGlyphDcts(context, cellSize, valueCheck, characters, glyphDrawingContext) {
    for (const character of characters) {
        if (character.length != 1 || typeof character !== 'string')
            throw new Error("character parameter was not a length-1 string");
    }

    const ctx = (glyphDrawingContext &&
                 glyphDrawingContext instanceof CanvasRenderingContext2D)
        ? glyphDrawingContext
        : document.createElement("canvas").getContext("2d");

    const gridSize = Math.ceil(Math.sqrt(characters.length));
    const size = cellSize.map((l) => l*gridSize);
    // TODO check if exceeds image size limit, and do multiple passes

    ctx.canvas.width = size[0];
    ctx.canvas.height = size[1];
    ctx.font = `${Math.min(...cellSize)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    switch (valueCheck) {
        case 'lights':
            ctx.fillStyle = 'black';
            break;
        case 'darks':
            ctx.fillStyle = 'white';
            break;
        case null:
            throw new Error("missing value check at glyph DCT computation");
        default:
            throw new Error(`unrecognized value check \"${valueCheck}\"`);
    }
    ctx.fillRect(0, 0, size[0], size[1]);

    switch (valueCheck) {
        case 'lights':
            ctx.fillStyle = 'white';
            break;
        case 'darks':
            ctx.fillStyle = 'black';
            break;
        case null:
            throw new Error("missing value check at glyph DCT computation");
        default:
            throw new Error(`unrecognized value check \"${valueCheck}\"`);
    }
    for (const [index, character] of characters.entries()) {
        const column = index % gridSize;
        const row = Math.floor(index/gridSize);
        const centerX = (column+0.5)*cellSize[0];
        const centerY = (row+0.5)*cellSize[1];
        ctx.fillText(character, centerX, centerY);
    }

    const gl = context.gl;
    const result = new ProcessingBuffer(gl, cellSize, [gridSize, gridSize], true);
    const glyphAtlas = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glyphAtlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ctx.canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    context.useDctProgram(cellSize);
    context.drawFrame();
    const resultCells = result.readCells((pixel) => (pixel[0]/255)*2.0-1.0);

    return resultCells.flat(1).slice(0, characters.length);
}

export function glyphDataUrl(character, cellSize, color, glyphDrawingContext) {
    if (character.length != 1 || typeof character !== 'string') {
        throw new Error("character parameter was not a length-1 string: "
            + character);
    }

    const ctx = (glyphDrawingContext &&
                 glyphDrawingContext instanceof CanvasRenderingContext2D)
        ? glyphDrawingContext
        : document.createElement("canvas").getContext("2d");

    ctx.canvas.width = cellSize[0];
    ctx.canvas.height = cellSize[1];
    ctx.font = `${Math.min(...cellSize)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.clearRect(0, 0, cellSize[0], cellSize[1]);
    ctx.fillStyle = color;
    ctx.fillText(character, cellSize[0]*0.5, cellSize[1]*0.5);

    return ctx.canvas.toDataURL();
}

export function glyphDataUrls(characters, cellSize, color, glyphDrawingContext) {
    for (const character of characters) {
        if (character.length != 1 || typeof character !== 'string')
            throw new Error("character parameter was not a length-1 string");
    }

    const ctx = (glyphDrawingContext &&
                 glyphDrawingContext instanceof CanvasRenderingContext2D)
        ? glyphDrawingContext
        : document.createElement("canvas").getContext("2d");

    ctx.canvas.width = cellSize[0];
    ctx.canvas.height = cellSize[1];
    ctx.font = `${Math.min(...cellSize)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;

    return characters.map((c) => {
        ctx.clearRect(0, 0, cellSize[0], cellSize[1]);
        ctx.fillText(c, cellSize[0]*0.5, cellSize[1]*0.5);
        return ctx.canvas.toDataURL();
    });
}

export function setGlyphImgs(glyphs, cellSize, color, glyphDrawingContext) {
    const ctx = (glyphDrawingContext &&
                 glyphDrawingContext instanceof CanvasRenderingContext2D)
        ? glyphDrawingContext
        : document.createElement("canvas").getContext("2d");

    ctx.canvas.width = cellSize[0];
    ctx.canvas.height = cellSize[1];
    ctx.font = `${Math.min(...cellSize)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;

    const x = cellSize[0] * 0.5;
    const y = cellSize[1] * 0.5;
    for (const glyph of glyphs) {
        ctx.clearRect(0, 0, cellSize[0], cellSize[1]);
        ctx.fillText(glyph[0], x, y);
        glyph[1].src = ctx.canvas.toDataURL();
    }
}

export function pixelToColor(rgba) {
    const r = Math.floor(rgba[0] * 255);
    const g = Math.floor(rgba[1] * 255);
    const b = Math.floor(rgba[2] * 255);
    const a = Math.floor(rgba[3] * 100);
    return (a==100) ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a}%)`;
}

export function drawValueDots(ctx, means, pixelValue, clearColor, interval, highlightColor) {
    const xStep = ctx.canvas.width / means[0].length;
    const yStep = ctx.canvas.height / means.length;
    const cellCoord = (r, c) => [xStep*0.5 + xStep*c, yStep*0.5 + yStep*r];
    const circleRadius = Math.min(xStep, yStep) * 0.5;

    if (clearColor) {
        tx.fillStyle = clearColor;
        tx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    } else {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    if (highlightColor) ctx.strokeStyle = highlightColor;

    for (const [rowIdx, row] of means.entries()) {
        for (const [colIdx, pixel] of row.entries()) {
            const value = pixelValue(pixel);
            const [x, y] = cellCoord(rowIdx, colIdx);
            const r = value * circleRadius;

            ctx.fillStyle = (pixel[4]==1.0)
                ? `rgb(
                    ${Math.floor(pixel[0]*255)}
                    ${Math.floor(pixel[1]*255)}
                    ${Math.floor(pixel[2]*255)})`
                : `rgb(
                    ${Math.floor(pixel[0]*255)}
                    ${Math.floor(pixel[1]*255)}
                    ${Math.floor(pixel[2]*255)}
                    / ${Math.floor(pixel[3]*100)}%)`;

            if (interval && value > interval[0] && value <= interval[1]) {
                const selectValue = Math.min(1, value*1.12);
                const sr = selectValue * circleRadius;
                ctx.beginPath();
                ctx.roundRect(x-sr, y-sr, 2*sr, 2*sr, 0.9*sr);
                ctx.fill();
                if (highlightColor) ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(x, y, r, 0, 2*Math.PI);
                ctx.fill();
            }
        }
    }
}

export function bucketCounts(pixels, bucketCount, pixelValue) {
    const buckets = Array(bucketCount).fill(0);
    for (const pixel of pixels) {
        const bucketValue = Math.min(bucketCount-1,
                            Math.floor(pixelValue(pixel)*bucketCount));
        buckets[bucketValue] += 1;
    }
    return buckets;
}

export function bucketPixels(pixels, bucketCount, pixelValue) {
    const buckets = Array(bucketCount).fill().map(() => []);
    for (const pixel of pixels) {
        const bucketValue = Math.min(bucketCount-1,
                            Math.floor(pixelValue(pixel)*bucketCount));
        buckets[bucketValue].push(pixel);
    }
    return buckets;
}

export function colorInputToRGB(inputNode) {
    // TODO branch depending on type of CSS color value string
    const hexString = inputNode.value;
    if (hexString.charAt(0) == '#') {
        return [
            parseInt(hexString.substring(1,3), 16) / 255,
            parseInt(hexString.substring(3,5), 16) / 255,
            parseInt(hexString.substring(5,7), 16) / 255
        ];
    } else {
        throw new Error("cannot parse color string " + hexString);
    }
}

function compileShaders(gl, vertexShaderSource, fragmentShaderSource) {
    const versionPrepend = "#version 300 es\n";
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, versionPrepend + vertexShaderSource);
    gl.compileShader(vertexShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
        console.log(gl.getShaderInfoLog(vertexShader));
        gl.deleteShader(vertexShader);
        throw new Error("Failed to compile vertex shader.");
    }

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, versionPrepend + fragmentShaderSource);
    gl.compileShader(fragmentShader);
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
        console.log(gl.getShaderInfoLog(fragmentShader));
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        throw new Error("Failed to compile fragment shader.");
    }

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.log(gl.getProgramInfoLog(program));
        gl.deleteShader(vertexShader);
        gl.deleteShader(fragmentShader);
        gl.deleteProgram(program);
        throw new Error("Failed to link shader program.");
    }

    return program;
}
