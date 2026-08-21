import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { describeDemoFailure } from '../demo/src/utils/demoFailure.js'

const read = path => readFile( new URL( `../${path}`, import.meta.url ), 'utf8' )

test( 'demo failures turn GPU limits into actionable device guidance', () => {
	const failure = describeDemoFailure(
		'render',
		new Error( 'Validation error: maxVertexBuffers limit is 8' ),
		'webgpu',
	)

	assert.equal( failure.eyebrow, 'Demo render failed' )
	assert.match( failure.guidance[0], /GPU limit/ )
	assert.match( failure.guidance[0], /updated browser or GPU driver/ )
	assert.match( failure.guidance[1], /selected WebGPU automatically/ )
} )

test( 'ExampleView exposes recovery actions and watches runtime GPU failures', async () => {
	const source = await read( 'demo/src/ExampleView.vue' )

	assert.match( source, /Reload demo/ )
	assert.match( source, /Browse examples/ )
	assert.match( source, /uncapturederror/ )
	assert.match( source, /webglcontextlost/ )
	assert.match( source, /unhandledrejection/ )
} )

test( 'compact demos preserve the canvas until a panel is requested', async () => {
	const [sandbox, sandboxView, topology] = await Promise.all( [
		read( 'demo/src/demos/sandbox.js' ),
		read( 'demo/src/views/SandboxView.vue' ),
		read( 'demo/src/demos/variableTopology.js' ),
	] )

	assert.match( sandbox, /activePanel: 'preview'/ )
	assert.match( sandbox, /compact && this\.uiState\.activePanel !== 'controls'/ )
	assert.match( sandboxView, /id: 'preview', label: 'Preview'/ )
	assert.match( sandboxView, /id: 'controls', label: 'Controls'/ )
	assert.match( sandboxView, /id: 'code', label: 'Code'/ )
	assert.match( topology, /compact && this\.isCompactGui !== true \) this\.gui\.close\(\)/ )
} )
