export const demoMeta = [
	{ id: 'basic', title: 'Basic', subtitle: 'overview', sourceFile: 'basic.js', group: 'basic' },
	{ id: 'waves', title: 'Waves', subtitle: 'animated positions', sourceFile: 'waves.js', group: 'basic' },
	{ id: 'follow', title: 'Follow', subtitle: 'trail physics', sourceFile: 'follow.js', group: 'basic' },
	{ id: 'vertex-colors', title: 'Vertex Colors', subtitle: 'vertex colors', sourceFile: 'vertexColors.js', group: 'basic' },
	{ id: 'gpu-circle', title: 'GPU Circle', subtitle: 'gpu positions', sourceFile: 'gpuCircle.js', group: 'basic' },
	{ id: 'gpu-instance', title: 'GPU Instancing', subtitle: 'instancing', sourceFile: 'gpuInstance.js', group: 'basic' },
	{ id: 'shadow', title: 'Shadows', subtitle: 'shadow casting', sourceFile: 'shadow.js', group: 'basic' },
	{ id: 'sandbox', title: 'Sandbox', subtitle: 'playground', sourceFile: 'sandbox.js', group: 'advanced', primary: true },
	{ id: 'ricefield', title: 'Rice Field', subtitle: 'storage buffers', sourceFile: 'ricefield.js', group: 'advanced' },
	{ id: 'drawlines', title: 'Draw Lines', subtitle: 'drawing', sourceFile: 'drawlines.js', group: 'advanced' },
	{ id: 'baguettes', title: 'Flying Baguettes', subtitle: 'multi-line batch', sourceFile: 'baguettes.js', group: 'advanced' },
	{ id: 'venus-and-david', title: 'Venus & David', subtitle: 'mesh paths', sourceFile: 'venus.js', group: 'advanced' },
	{ id: 'bamboooo', title: 'Bamboooo', subtitle: 'instancing + shadows', sourceFile: 'bambooGrove.js', group: 'advanced' },
	{ id: 'laser-heist', title: 'Laser Heist', subtitle: 'raycast vs picker', sourceFile: 'heist.js', group: 'advanced' },
]

export const basicDemoMeta = demoMeta.filter( demo => demo.group === 'basic' )
export const advancedDemoMeta = demoMeta.filter( demo => demo.group === 'advanced' )

export const resolveDemoMeta = ( id ) => {
	return demoMeta.find( demo => demo.id === id || demo.aliases?.includes( id ) )
}