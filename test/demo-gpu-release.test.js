import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile( new URL( `../demo/src/${path}`, import.meta.url ), 'utf8' )

// Each of these held GPU memory after leaving its route, measured by counting live GPUBuffers.
test( 'demos release the GPU memory that clearDemo() cannot reach on its own', async () => {
	const [bridge, studio, room, tubeStudio, tunnelStage, windTunnel, pipeline, compute] = await Promise.all( [
		read( 'utils/surfaceRoadBridge.js' ),
		read( 'utils/surfaceStudio.js' ),
		read( 'utils/heistRoom.js' ),
		read( 'utils/metallicTubeStudio.js' ),
		read( 'utils/windTunnelStage.js' ),
		read( 'demos/windTunnel.js' ),
		read( 'utils/gpuSimplificationPipeline.js' ),
		read( 'utils/gpuSimplificationCompute.js' ),
	] )

	// Geometry dispose frees only the attributes it holds, so a live edit releases each one it replaces.
	assert.match( bridge, /function releaseBuffers\( geometry \) \{\s*for \( const attribute of \[geometry\.index, \.\.\.Object\.values\( geometry\.attributes \)\] \) \{\s*if \( attribute \) stage3d\.release\( attribute \)/ )
	for ( const name of ['allocateDeck', 'allocateFascia', 'allocateBerm'] ) {
		assert.match( bridge, new RegExp( `function ${name}\\( geometry, [^)]*\\) \\{\\s*releaseBuffers\\( geometry \\)\\s*geometry\\.setAttribute\\(` ), `${name} releases before it replaces` )
	}

	// Disposing a PMREM texture leaves its render target behind: own the target.
	for ( const source of [studio, room, tubeStudio, tunnelStage] ) {
		assert.match( source, /stage3d\.own\( pmrem\.fromScene\( \w+(, [\d.]+)? \) \)/ )
		assert.doesNotMatch( source, /pmrem\.fromScene\([^)]*\)\.texture \)/ )
	}

	for ( const buffer of ['sdfBuffer', 'nozzleBuffer', 'positionBuffer'] ) {
		assert.match( windTunnel, new RegExp( `this\\.${buffer} = stage3d\\.own\\(` ) )
	}

	// Pass and geometry dispose never free storage or indirect buffers, the passes' scratch included.
	assert.match( compute, /scratch: \[geometry, relaxScratch, keep, settled, localRanks, compacted, blockCounts, blockOffsets\]\.map\( node => node\.value \)/ )
	assert.match( pipeline, /const \{ passes: pass, scratch \} = createSimplificationPasses\( this\.buffers, this\.uniforms \)\s+this\.scratch = scratch/ )
	assert.match( pipeline, /for \( const buffer of \[\.\.\.Object\.values\( this\.buffers \), \.\.\.this\.scratch\] \) stage3d\.release\( buffer \)/ )
} )
