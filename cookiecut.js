let gl;
let program;
let texture;
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

const dctFragmentSource = `
    precision mediump float;
    varying vec2 texCoord;
    uniform vec2 pixelSize;
    uniform vec2 cellSize;
    uniform sampler2D image;
    void main() {
        vec2 cellPixelSize = cellSize/pixelSize;
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

    program = compileShaders(flatSampleVertexSource, dctFragmentSource);
    gl.useProgram(program);
    gl.clearColor(0, 0, 0, 0);

    const texCoordAttrib = gl.getAttribLocation(program, "coord");
    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        0.0, 0.0,
        1.0, 0.0,
        0.0, 1.0,
        0.0, 1.0,
        1.0, 0.0,
        1.0, 1.0,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(texCoordAttrib);
    gl.vertexAttribPointer(texCoordAttrib, 2, gl.FLOAT, false, 0, 0);

    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
        processImage();
    } else {
        throw new Error('uncastable cell size input "' + size + '"');
    }
}

export function setImage(image) {
    userImage = image;
    processImage();
}

function processImage() {
    if (userImage) {
        const width = userImage.naturalWidth;
        const height = userImage.naturalHeight;
        const paddedWidth = Math.ceil(width/cellSize)*cellSize;
        const paddedHeight = Math.ceil(height/cellSize)*cellSize;

        gl.canvas.width = paddedWidth;
        gl.canvas.height = paddedHeight;
        gl.viewport(0, 0, paddedWidth, paddedHeight);

        gl.uniform2f(gl.getUniformLocation(program, "pixelSize"),
            1.0 / paddedWidth,
            1.0 / paddedHeight,
        );
        gl.uniform2f(gl.getUniformLocation(program, "cellSize"),
            cellSize / paddedWidth,
            cellSize / paddedHeight,
        );

        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, userImage);

        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    } else {
        gl.canvas.width = 1;
        gl.canvas.height = 1;
        gl.viewport(0, 0, 1, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
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
