// Menu sections, in gallery order.
export const demoSections = [
	{ id: 'start', title: 'Start here' },
	{ id: 'lines', title: 'Lines' },
	{ id: 'ribbons', title: 'Ribbons' },
	{ id: 'gpu', title: 'GPU at scale' },
	{ id: 'scenes', title: 'Scenes' },
]

// Array order is the menu order and the previous / next order inside a demo.
// `blurb` and `apis` feed the menu details and search, `subtitle` the page title.
// Each menu demo has a thumbnail at demo/public/thumbs/<id>.webp.
// `hidden` demos keep their route but stay off the menu.
export const demoCatalog = [
	{ id: 'basic', section: 'start', title: 'Style Gallery', subtitle: 'options + TSL hooks', blurb: 'Sixteen line styles side by side: widths, dashes, gradients, textures and TSL hooks.', apis: ['widthFn()', 'dashFn()', 'gradientFn()', 'opacityFn()'], sourceFile: 'featureGallery.js', aliases: ['feature-gallery'] },
	{ id: 'variable-topology', section: 'start', title: 'Joins & Caps', subtitle: 'joins, caps + clipping', blurb: 'Miter, bevel and round joins, butt, square and round caps, and sharp reversals.', apis: ['join()', 'cap()'], sourceFile: 'variableTopology.js' },
	{ id: 'sandbox', section: 'start', title: 'Playground', subtitle: 'tune and copy code', blurb: 'Change any option with live sliders and copy the code it generates.', apis: ['every option'], sourceFile: 'sandbox.js' },

	{ id: 'waves', section: 'lines', title: 'Waves', subtitle: 'animated positions + vertex colors', blurb: 'A synthwave sea: every point moved and recolored each frame.', apis: ['vertexColors()', 'setPositions()'], sourceFile: 'waves.js', aliases: ['vertex-colors'] },
	{ id: 'drawlines', section: 'lines', title: 'Draw & Trail', subtitle: 'live point + color updates', blurb: 'Lines trail your cursor. Drag to paint glowing strokes.', apis: ['setPositionRange()', 'setVertexValues()'], sourceFile: 'drawlines.js', aliases: ['v2-updates'] },
	{ id: 'gpu-instance', section: 'lines', title: 'Ring Tunnel', subtitle: 'GPU positions, one draw', blurb: '150 rings in one draw call, placed and recolored on the GPU. Hold to warp.', apis: ['instances()', 'gpuPositionNode()', 'setInstanceValues()'], sourceFile: 'gpuInstance.js', aliases: ['gpu-circle'] },
	{ id: 'metallic-tube', section: 'lines', title: 'Metallic Tube', subtitle: 'PBR tube illusion', blurb: 'A flat line shaded to read as a lit chrome tube.', apis: ['normalFn()', 'join()'], sourceFile: 'metallicTube.js' },
	{ id: 'shadow', section: 'lines', title: 'Shadows', subtitle: 'cast and receive', blurb: 'Lines casting and receiving shadows under three moving spotlights.', apis: ['castShadow', 'receiveShadow'], sourceFile: 'shadow.js' },
	{ id: 'laser-heist', section: 'lines', title: 'Laser Heist', subtitle: 'raycast vs picker', blurb: 'Aim at the lasers to compare raycasting with GPU picking.', apis: ['MeshLinePicker', 'raycast()'], sourceFile: 'heist.js', aliases: ['bunker'] },

	{ id: 'surface', section: 'ribbons', title: 'Surface Studio', subtitle: 'frames, banking + mapped PBR', blurb: 'One path as a lit ribbon: fixed-up or transport frames, banking and PBR maps.', apis: ['surface()', 'frame', 'uvMode'], sourceFile: 'surface.js' },
	{ id: 'surface-road', section: 'ribbons', title: 'Road Editor', subtitle: 'adaptive 3D road editor', blurb: 'Drag control points to build a banked 3D road with painted lanes.', apis: ['surface()', 'setPositions()'], sourceFile: 'surfaceRoad.js' },

	{ id: 'gpu-path', section: 'gpu', title: '200K-Point Line', subtitle: '200k points, one GPU draw', blurb: 'One line with 200,000 points. The GPU trims it to the 1,646 segments that keep its shape.', apis: ['MeshLineGPUPath'], sourceFile: 'gpuPath.js', status: 'experimental' },
	{ id: 'gpu-culling', section: 'gpu', title: 'Alpine Pass Culling', subtitle: '400K-point frustum culling', blurb: 'A 400,000-point alpine pass and contours. Watch the 3D frustum cone cull offscreen chunks live.', apis: ['MeshLineCullingSystem'], sourceFile: 'gpuCulling.js' },
	{ id: 'gpu-simplification', section: 'gpu', title: 'GPU Simplification', subtitle: 'Douglas-Peucker on GPU', blurb: 'Research prototype: Douglas-Peucker simplification running in compute shaders.', apis: ['compute shaders'], sourceFile: 'gpuSimplificationPrototype.js', status: 'experimental' },
	{ id: 'compute-curves', section: 'gpu', title: 'Compute Curves', subtitle: 'WebGPU curve engine', blurb: 'Thousands of curves simulated in a compute shader. Move to stir them.', apis: ['MeshLineCompute'], sourceFile: 'meshlineCompute.js', status: 'experimental', requires: 'webgpu' },
	{ id: 'lorenz-trails', section: 'gpu', title: 'Lorenz Attractor', subtitle: 'ring-buffer compute trails', blurb: '64 trails orbiting a chaotic attractor. The GPU writes only the newest points of each trail.', apis: ['storagePositions({ head })'], sourceFile: 'lorenzTrails.js', status: 'experimental', requires: 'webgpu' },
	{ id: 'verlet-ropes', section: 'gpu', title: 'Verlet Ropes', subtitle: 'interactive GPU rope playground', blurb: 'Grab, swing and throw ropes simulated on the GPU.', apis: ['gpuPositionNode()', 'instances()'], sourceFile: 'verletRopes.js', status: 'experimental' },

	{ id: 'isobars', section: 'scenes', title: 'Isobars', subtitle: 'synoptic contour morphing', blurb: 'Weather-map contours morphing between pressure systems.', apis: ['storagePositions()', 'morph'], sourceFile: 'isobars.js', aliases: ['isobar'] },
	{ id: 'ricefield', section: 'scenes', title: 'Rice Field', subtitle: 'storage buffers', blurb: 'Wind through thousands of instanced blades. Click for a shockwave.', apis: ['instances()', 'positionFn()'], sourceFile: 'ricefield.js' },
	{ id: 'bamboooo', section: 'scenes', title: 'Bamboooo', subtitle: 'instancing + shadows', blurb: 'An instanced bamboo grove casting and receiving soft shadows.', apis: ['instances()', 'castShadow', 'receiveShadow'], sourceFile: 'bambooGrove.js' },
	{ id: 'venus-and-david', section: 'scenes', title: 'Venus & David', subtitle: 'mesh paths', blurb: 'Two statues traced as stacks of glowing contour lines.', apis: ['instances()', 'gpuPositionNode()'], sourceFile: 'venus.js' },
	{ id: 'baguettes', section: 'scenes', title: 'Flying Baguettes', subtitle: 'multi-line batch', blurb: 'Dozens of textured lines in one geometry and one draw call.', apis: ['lines([ … ])', 'map()'], sourceFile: 'baguettes.js' },

	// Draw & Trail covers the same cursor trails, so Follow leaves the menu; its route still works.
	{ id: 'follow', section: 'lines', title: 'Follow', subtitle: 'trail physics', blurb: 'A bundle of aurora trails chasing the cursor with spring physics.', apis: ['setPositions()'], sourceFile: 'follow.js', hidden: true },
]
