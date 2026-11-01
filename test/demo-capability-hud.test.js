import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile( new URL( `../${path}`, import.meta.url ), 'utf8' )
const readDemo = name => read( `demo/src/demos/${name}.js` )

test( 'GPU Culling reports warm-up, active, baseline, and draw-all states without covering the scene', async () => {
	const [source, ui, exampleView] = await Promise.all( [
		readDemo( 'gpuCulling' ),
		read( 'demo/src/components/GpuCulling.vue' ),
		read( 'demo/src/ExampleView.vue' ),
	] )
	const update = source.slice( source.indexOf( '\tupdate = dt => {' ), source.indexOf( '\tonResize = () => {' ) )

	// No instruction text: ExampleView falls back to an empty one.
	assert.doesNotMatch( source, /^\s*(?:this\.)?text = /m )
	assert.match( exampleView, /this\.text = this\.example\.text \|\| ''/ )
	assert.match( source, /uiComponent = markRaw\( GpuCulling \)/ )
	assert.match( ui, /\.GpuCullingHud\n\tposition fixed[\s\S]*?left calc\(/ )
	assert.match( ui, /aria-live="polite"/ )
	assert.match( source, /badge = 'WebGPU warm-up'/ )
	assert.match( source, /badge = 'WebGPU active'/ )
	assert.match( source, /badge = 'Culling off'/ )
	assert.match( source, /badge = backend === 'webgl2' \? 'WebGL2 fallback' : 'Draw-all fallback'/ )
	// The frame loop drives the HUD, so warm-up to active shows without a click,
	// and ExampleView holds the only subscription, which ends with the demo.
	assert.match( update, /this\.updateHud\(\)/ )
	assert.match( exampleView, /if \( update \) stage3d\.listen\( stage\.onUpdate, update \)/ )
	assert.doesNotMatch( source, /stage\.onUpdate\.(?:add|remove)/ )
	assert.match( source, /window\.__meshLineCullingMetrics = null/ )
} )

test( 'GPU Culling reads its snapshot for the culled camera before moving it', async () => {
	const source = await readDemo( 'gpuCulling' )
	const update = source.slice( source.indexOf( '\tupdate = dt => {' ), source.indexOf( '\tupdateCamera( dt ) {' ) )

	// A handle refuses to report a camera it has not prepared, so reading after
	// the flight step silently yields no snapshot at all.
	assert.ok( update.indexOf( 'this.readSnapshot()' ) !== -1 )
	assert.ok( update.indexOf( 'this.readSnapshot()' ) < update.indexOf( 'this.updateCamera( dt )' ) )
	assert.match( source, /handle\.readCullingSnapshot\(\)/ )
	assert.match( source, /this\.culling\.remove\( this\.handle \)/, 'the baseline toggle detaches the line instead of rebuilding the scene' )
} )
