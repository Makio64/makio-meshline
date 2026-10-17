import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readDemo = name => readFile( new URL( `../demo/src/demos/${name}.js`, import.meta.url ), 'utf8' )

test( 'GPU Culling reports warm-up, active, baseline, and draw-all states without covering the scene', async () => {
	const source = await readDemo( 'gpuCulling' )

	assert.match( source, /this\.text = ''/ )
	assert.match( source, /\.GpuCullingHud \{[\s\S]*?position: fixed;[\s\S]*?left: calc\(/ )
	assert.match( source, /this\.hud\.setAttribute\( 'aria-live', 'polite' \)/ )
	assert.match( source, /badge = 'WebGPU warm-up'/ )
	assert.match( source, /badge = 'WebGPU active'/ )
	assert.match( source, /badge = 'Culling off'/ )
	assert.match( source, /badge = backend === 'webgl2' \? 'WebGL2 fallback' : 'Draw-all fallback'/ )
	assert.match( source, /stage\.onUpdate\.add\( this\.updateHud \)/ )
	assert.match( source, /stage\.onUpdate\.remove\( this\.updateHud \)/ )
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
