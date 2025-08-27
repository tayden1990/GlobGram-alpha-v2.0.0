// Advanced grid utility for conferencing layouts based on palerdot/video-conferencing-ui
// Calculates optimal tile dimensions by testing square fit, horizontal fit, and vertical fit

export type GridDims = { cols: number; rows: number };
export type Dimension = { width: number; height: number };

type GridInput = {
  dimension: Dimension;
  total_grids: number;
  aspect_ratio: number;
};

// Simple lodash replacements
function maxBy<T>(array: T[], iteratee: (item: T) => number): T | undefined {
  if (!array.length) return undefined;
  return array.reduce((max, current) => 
    iteratee(current) > iteratee(max) ? current : max
  );
}

function round(num: number, precision: number): number {
  const factor = Math.pow(10, precision);
  return Math.round(num * factor) / factor;
}

// Find nearest square root (for up to 49 participants)
function nearest_square_root(n: number): number {
  if (n === 1) return 1;
  if (n > 1 && n <= 4) return 2;
  if (n > 4 && n <= 9) return 3;
  if (n > 9 && n <= 16) return 4;
  if (n > 16 && n <= 25) return 5;
  if (n > 25 && n <= 36) return 6;
  if (n > 36 && n <= 49) return 7;
  return 7;
}

// Calculate optimal tile dimensions using square fit
function square_fit(input: GridInput): Array<Dimension> {
  const { dimension, total_grids, aspect_ratio } = input;
  const max_squares = nearest_square_root(total_grids);
  const valid_fits: Array<Dimension> = [];

  // Landscape square fit
  const landscape_width = Math.floor(dimension.width / max_squares);
  const landscape_height = landscape_width / aspect_ratio;
  const landscape_fit: Dimension = { width: landscape_width, height: landscape_height };
  
  const is_valid_landscape_fit =
    landscape_fit.width * max_squares <= dimension.width &&
    landscape_fit.height * max_squares <= dimension.height;

  if (is_valid_landscape_fit) {
    valid_fits.push(landscape_fit);
  }

  // Portrait square fit
  const portrait_height = Math.floor(dimension.height / max_squares);
  const portrait_width = portrait_height * aspect_ratio;
  const portrait_fit: Dimension = { width: portrait_width, height: portrait_height };
  
  const is_valid_portrait_fit =
    portrait_fit.width * max_squares <= dimension.width &&
    portrait_fit.height * max_squares <= dimension.height;

  if (is_valid_portrait_fit) {
    valid_fits.push(portrait_fit);
  }

  return valid_fits;
}

// Calculate horizontal and vertical fit
function horizontal_vertical_fit(input: GridInput): Array<Dimension> {
  const { dimension, total_grids, aspect_ratio } = input;
  const valid_fits: Array<Dimension> = [];

  // Horizontal fit: tiles across width
  const horizontal_fit_width = Math.floor(dimension.width / total_grids);
  const horizontal_fit: Dimension = {
    width: horizontal_fit_width,
    height: horizontal_fit_width / aspect_ratio,
  };
  const overflow_height = dimension.height - horizontal_fit.height;
  if (overflow_height >= 0) {
    valid_fits.push(horizontal_fit);
  }

  // Vertical fit: tiles stacked vertically
  const vertical_fit_height = Math.floor(dimension.height / total_grids);
  const vertical_fit: Dimension = {
    width: vertical_fit_height * aspect_ratio,
    height: vertical_fit_height,
  };
  const overflow_width = dimension.width - vertical_fit.width;
  if (overflow_width >= 0) {
    valid_fits.push(vertical_fit);
  }

  return valid_fits;
}

// Main function to calculate optimal grid dimensions
export function calculate_grid_dimension(input: GridInput): Dimension {
  const square_fittings = square_fit(input);
  const horizontal_vertical_fittings = horizontal_vertical_fit(input);

  const { width, height } = maxBy(
    [...square_fittings, ...horizontal_vertical_fittings],
    (dim: Dimension) => dim.width
  ) || { width: 0, height: 0 };

  return { width: round(width, 2), height: round(height, 2) };
}

// Legacy function for backward compatibility
export function computeGridDimensions(width: number, height: number, count: number, aspectWH = 16 / 9): GridDims {
  if (!count || width <= 0 || height <= 0) return { cols: 1, rows: 1 };
  
  // Use advanced calculation to get optimal tile size
  const tileDimension = calculate_grid_dimension({
    dimension: { width, height },
    total_grids: count,
    aspect_ratio: aspectWH,
  });
  
  // Convert back to cols/rows
  const cols = Math.floor(width / tileDimension.width) || 1;
  const rows = Math.ceil(count / cols);
  
  return { cols: Math.max(1, cols), rows: Math.max(1, rows) };
}
