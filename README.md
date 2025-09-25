# CookieCut

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
CookieCut picks for each cell the character best matching its rough greyscale pattern
by comparison in the frequency domain.

- The candidate glyphs and image cell are each downscaled to 8 pixels
- The [discrete cosine transform](https://wikipedia.org/wiki/Discrete_cosine_transform) of each is taken
- Each candidate glyph is compared to the cell by distance of the lower-frequency components
- The least total distance glyph is selected to represent the cell
