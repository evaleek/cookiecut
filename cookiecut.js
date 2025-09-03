let gl;
let canvasDCTProgram;
let texCoordBuffer;
let imageTexture;
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

        canvasDCTProgram = compileShaders(
            flatSampleVertexSource,
            dctFragmentSource(cellSize, cellSize, width, height),
        );
        gl.useProgram(canvasDCTProgram);

        gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
        const texCoordAttrib = gl.getAttribLocation(canvasDCTProgram, "coord");
        gl.enableVertexAttribArray(texCoordAttrib);
        gl.vertexAttribPointer(texCoordAttrib, 2, gl.FLOAT, false, 0, 0);

        const imageDctTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, imageDctTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height,
            0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const framebuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
            gl.TEXTURE_2D, imageDctTexture, 0);

        gl.bindTexture(gl.TEXTURE_2D, imageTexture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, userImage);

        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        let dctBytes = new Uint8Array(width*height*4);
        gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, dctBytes);
        imageDCT = new Array(canvasCellWidth).fill()
            .map((_, gridColumn) => new Array(canvasCellHeight).fill()
            .map((_, gridRow) => new Array(cellSize).fill()
            .map((_, cellColumn) => new Array(cellSize).fill()
            .map((_, cellRow) => {
                const pixelRowCellBase = canvasCellHeight-gridRow-1;
                const pixelRowCellOffset = cellSize-cellRow-1;
                const pixelRow = (pixelRowCellBase * cellSize)
                                 + pixelRowCellOffset;
                const pixelColumn = (gridColumn*cellSize)+cellColumn;
                const pixelIndex = (pixelRow * width) + pixelColumn;
                return dctBytes[pixelIndex*4] / 255;
            }))));

        // TODO delete
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6)
        console.log(imageDCT[0][0]);

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
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
