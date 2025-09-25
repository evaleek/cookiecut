# CookieCut - An ASCII art image processing webapp

__CookieCut__ is a client-side, GPU-accelerated JavaScript
image processing tool to create ASCII art representations of user images.

## Features

- Adjust image cell subdivision granularity
- Mask out any number of colors
- Toggle between lights on dark background or darks on light background
- Sort image cells by value into any number of value threshold levels
- Adjust thresholds along a histogram of cell values
- Specify any number of characters with which to best-fit all cells in a given threshold

## Implementation

### GPU acceleration

CookieCut uses WebGL 2 shaders to
downscale the image,
take its Sobel-Feldman convolution for edge detection, and
compute the discrete cosine transform of each cell.

### Frequency domain pattern matching

When the user inputs more than one character to represent a cell value threshold,
CookieCut picks for each cell the character best matching its rough greyscale pattern.
Downscaled candidate glyphs are best-fit to downscaled image cells
by least total distance of the lower-frequency components
of each of their [discrete cosine transforms](https://wikipedia.org/wiki/Discrete_cosine_transform).
