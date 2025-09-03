let gl;
let redrawProgram;
let sobelProgram;
let canvasDCTProgram;
let texCoordBuffer;
let imageTexture;
let imagePixels;
let imageSobel;
let imageDCT;
let cellSize = 8;
let userImage;

const flatSampleVertexSource = `
    attribute vec2 coord;
    varying vec2 texCoord;
    void main() {
        gl_Position = vec4(coord*vec2(2,-2)-vec2(1,-1), 0, 1);
        texCoord = coord;
    }
`;

const imageRedrawFragmentSource = `
    precision mediump float;
    varying vec2 texCoord;
    uniform sampler2D image;
    void main() {
        gl_FragColor = texture2D(image, texCoord);
    }
`;

const sobelFragmentSource = `
    precision mediump float;
    varying vec2 texCoord;
    uniform sampler2D image;
    uniform vec2 pixelSize;
    vec2 sobel(sampler2D texture, vec2 coord, vec2 pixel) {
        const float sqrt3 = sqrt(3.0);
        float tl = length(texture2D(texture, coord+pixel*vec2(-1,-1)).rgb)/sqrt3;
        float tc = length(texture2D(texture, coord+pixel*vec2( 0,-1)).rgb)/sqrt3;
        float tr = length(texture2D(texture, coord+pixel*vec2( 1,-1)).rgb)/sqrt3;
        float cl = length(texture2D(texture, coord+pixel*vec2(-1, 0)).rgb)/sqrt3;
        float cr = length(texture2D(texture, coord+pixel*vec2( 1, 0)).rgb)/sqrt3;
        float bl = length(texture2D(texture, coord+pixel*vec2(-1, 1)).rgb)/sqrt3;
        float bc = length(texture2D(texture, coord+pixel*vec2( 0, 1)).rgb)/sqrt3;
        float br = length(texture2D(texture, coord+pixel*vec2( 1, 1)).rgb)/sqrt3;
        float gx = -tl - 2.0*cl - bl + tr + 2.0*cr + br;
        float gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
        return vec2(gx, gy);
    }
    void main() {
        vec2 gradient = sobel(image, texCoord, pixelSize);
        gl_FragColor = vec4(gradient, length(gradient)/sqrt(2.0), 1);
    }
`;

const dctFragmentSource = (cellWidth, cellHeight, canvasWidth, canvasHeight) => `
    precision mediump float;
    varying vec2 texCoord;
    uniform sampler2D image;
    const vec2 cellPixelSize = vec2(${cellWidth}, ${cellHeight});
    const vec2 pixelSize = vec2(${1.0/canvasWidth}, ${1.0/canvasHeight});
    const vec2 cellSize = vec2(${cellWidth/canvasWidth}, ${cellHeight/canvasHeight});
    void main() {
        vec2 cell = floor(texCoord/cellSize);
        vec2 cellBase = cell*cellSize;
        vec2 freqUV = (texCoord-cellBase)/pixelSize;
        float dct = 0.0;
        for (float cellPixelX = 0.0; cellPixelX < cellPixelSize.x; cellPixelX += 1.0) {
            for (float cellPixelY = 0.0; cellPixelY < cellPixelSize.y; cellPixelY += 1.0) {
                vec2 cellPixel = vec2(cellPixelX, cellPixelY);
                float pixelValue = length(texture2D(image,
                    cellPixel * pixelSize + cellBase)) * 0.5;
                vec2 dctXY = pixelValue * cos(
                    (vec2(3.1415926538)/cellPixelSize)
                    * (cellPixel+0.5)
                    * freqUV);
                dct += dctXY.x + dctXY.y;
            }
        }
        gl_FragColor = vec4(dct, 0, 0, 1);
    }
`

export const supported = () => typeof WebGLRenderingContext !== 'undefined';

export function init(canvas) {
    gl = canvas.getContext("webgl");
    if (!gl) throw new Error("Could not initialize WebGL.");

    redrawProgram = compileShaders(
        flatSampleVertexSource,
        imageRedrawFragmentSource,
    );

    sobelProgram = compileShaders(
        flatSampleVertexSource,
        sobelFragmentSource,
    );

    texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0.0, 0.0,
        1.0, 0.0,
        0.0, 1.0,
        0.0, 1.0,
        1.0, 0.0,
        1.0, 1.0,
    ]), gl.STATIC_DRAW);
    for (const program of [redrawProgram, sobelProgram]) {
        const texCoordAttrib = gl.getAttribLocation(program, "coord");
        gl.enableVertexAttribArray(texCoordAttrib);
        gl.vertexAttribPointer(texCoordAttrib, 2, gl.FLOAT, false, 0, 0);
    }

    imageTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, imageTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.clearColor(0, 0, 0, 0);
}

export function setCellSize(size) {
    const asNumber = Number(size);
    if (asNumber) {
        if (asNumber >= 4 && Number.isInteger(asNumber)) {
            cellSize = asNumber;
        } else {
            const fit = Math.max(4, Math.round(asNumber));
            console.warn('unexpected cell size input value "' + size + '" rounded to ' + fit);
            cellSize = fit;
        }
        refresh();
    } else {
        throw new Error('uncastable cell size input "' + size + '"');
    }
}

export function setImage(image) {
    userImage = image;
    refresh();
}

export function refresh() {
    if (userImage) {
        if (cellSize < 4 || !Number.isInteger(cellSize)) {
            throw new Error("unexpected cellSize value " + cellSize);
        }

        const canvasCellWidth = Math.ceil(userImage.naturalWidth / cellSize);
        const canvasCellHeight = Math.ceil(userImage.naturalHeight / cellSize);
        const width = canvasCellWidth * cellSize;
        const height = canvasCellHeight * cellSize;

        gl.canvas.width = width;
        gl.canvas.height = height;
        gl.viewport(0, 0, width, height);

        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);

        gl.useProgram(redrawProgram);

        canvasDCTProgram = compileShaders(
            flatSampleVertexSource,
            dctFragmentSource(cellSize, cellSize, width, height),
        );
        const texCoordAttrib = gl.getAttribLocation(canvasDCTProgram, "coord");
        gl.enableVertexAttribArray(texCoordAttrib);
        gl.vertexAttribPointer(texCoordAttrib, 2, gl.FLOAT, false, 0, 0);

        const resultTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, resultTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height,
            0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
            gl.TEXTURE_2D, resultTexture, 0);

        gl.bindTexture(gl.TEXTURE_2D, imageTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, userImage);

        let dctBytes = new Uint8Array(width*height*4);

        gl.useProgram(redrawProgram);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, dctBytes);
        imagePixels = pixelDataAsBlocks(
            cellSize, canvasCellWidth, canvasCellHeight, width, dctBytes,
            (pixel) => Array.from(pixel, (x) => x/255));

        gl.useProgram(canvasDCTProgram);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, dctBytes);
        imageDCT = pixelDataAsBlocks(
            cellSize, canvasCellWidth, canvasCellHeight, width, dctBytes,
            (pixel) => pixel[0]/255);

        gl.useProgram(sobelProgram);
        gl.uniform2f(gl.getUniformLocation(sobelProgram, "pixelSize"),
            1.0/width, 1.0/height);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, dctBytes);
        imageSobel = pixelDataAsBlocks(
            cellSize, canvasCellWidth, canvasCellHeight, width, dctBytes,
            (pixel) => Array.from(pixel, (x) => x/255));

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
}

function pixelDataAsBlocks(cellSize, canvasCellWidth, canvasCellHeight,
                           canvasWidth, data, mapPixel) {
    return new Array(canvasCellWidth).fill()
        .map((_, gridColumn) => new Array(canvasCellHeight).fill()
        .map((_, gridRow) => new Array(cellSize).fill()
        .map((_, cellColumn) => new Array(cellSize).fill()
        .map((_, cellRow) => {
            const pixelRowCellBase = canvasCellHeight-gridRow-1;
            const pixelRowCellOffset = cellSize-cellRow-1;
            const pixelRow = (pixelRowCellBase * cellSize)
                             + pixelRowCellOffset;
            const pixelColumn = (gridColumn*cellSize)+cellColumn;
            const pixelIndex = (pixelRow * canvasWidth) + pixelColumn;
            const byteIndex = pixelIndex*4;
            return mapPixel(data.slice(byteIndex, byteIndex+4));
        }))));
}

function compileShaders(vertexShaderSource, fragmentShaderSource) {
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
        console.log(gl.getShaderInfoLog(vertexShader));
        gl.deleteShader(vertexShader);
        throw new Error("Failed to compile vertex shader.");
    }

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentShaderSource);
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
