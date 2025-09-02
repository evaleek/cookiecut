let gl;
let program;
let texture;

const vertexSource = `
    attribute vec2 coord;
    varying vec2 texCoord;
    void main() {
        gl_Position = vec4(coord*vec2(2,-2)-vec2(1,-1), 0, 1);
        texCoord = coord;
    }
`;

const fragmentSource = `
    precision mediump float;
    varying vec2 texCoord;
    uniform sampler2D image;
    void main() {
        gl_FragColor = texture2D(image, texCoord);
    }
`;

export const supported = () => typeof WebGLRenderingContext !== 'undefined';

export function init(canvas) {
    gl = canvas.getContext("webgl");
    if (!gl) throw new Error("Could not initialize WebGL.");

    program = compileShaders(vertexSource, fragmentSource);
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

export function setImage(image) {
    if (image) {
        const width = image.naturalWidth;
        const height = image.naturalHeight;

        gl.canvas.width = width;
        gl.canvas.height = height;
        gl.viewport(0, 0, width, height);

        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
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
