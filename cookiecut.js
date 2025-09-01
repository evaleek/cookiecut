let gl;

export const supported = () => typeof WebGLRenderingContext !== 'undefined';

export function init(canvas) {
    gl = canvas.getContext("webgl");
    if (!gl) throw new Error("Could not initialize WebGL.");
}

export function setImage(image) {
    console.log("image was set");
}
