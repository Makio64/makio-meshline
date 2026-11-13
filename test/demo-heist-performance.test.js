import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile( new URL( `../${path}`, import.meta.url ), 'utf8' )

test( 'Heist bounds post-processing cost and avoids idle picking churn', async () => {
	const [heist, room, bloom, orbit, stage3d] = await Promise.all( [
		read( 'demo/src/demos/heist.js' ),
		read( 'demo/src/utils/heistRoom.js' ),
		read( 'demo/src/utils/bloomPipeline.js' ),
		read( 'demo/src/makio/three/controls/OrbitControl.js' ),
		read( 'demo/src/makio/three/stage3d.js' ),
	] )

	assert.match( heist, /maxPixelRatio: 1\.25/ )
	assert.match( stage3d, /Math\.min\( stage\.devicePixelRatio, this\.maxPixelRatio/ )
	// Orbit options land on the control, which stops a still pointer re-dirtying picks.
	assert.match( heist, /extraThetaMouse: false/ )
	assert.match( heist, /extraPhiMouse: false/ )
	assert.match( orbit, /Object\.assign\( this, options \)/ )
	assert.match( room, /resolutionScale: isMobile \? 0\.35 : 0\.5/ )
	assert.match( room, /generateMipmaps: false/ )
	// Sub-pixel lasers need multisampling, not resolution, to stay continuous.
	assert.match( room, /samples: isMobile \? 0 : 4/ )
	assert.match( heist, /scenePass\.setResolutionScale\( isMobile \? 0\.65 : 0\.8 \)/ )
	assert.match( heist, /createBloomPipeline\( \{[^}]*resolutionScale: isMobile \? 0\.25 : 0\.3 \} \)/ )
	assert.match( bloom, /bloomPass\.setResolutionScale\( resolutionScale \)/ )
	assert.match( heist, /this\._pickDirty && this\._pickElapsed >= PICK_INTERVAL/ )
	assert.match( heist, /intersectObject\( this\.line, false, this\._raycastHits \)/ )
	// Fragment hooks keep a uv array by default; neither line's hooks read it.
	for ( const start of ['this.line = new MeshLine()', 'const scanLine = new MeshLine()'] ) {
		const from = heist.indexOf( start )
		assert.notEqual( from, -1, `${start} should remain statically inspectable` )
		const chain = heist.slice( from, heist.indexOf( '.autoResize()', from ) ).replace( /\/\/.*$/gm, '' )
		assert.match( chain, /^\t+\.needsUV\( false \)$/m )
		assert.match( chain, /\.fragmentColorFn\( Fn\( \( \[\w+\] \) =>/ )
		assert.doesNotMatch( chain, /\buv\(/ )
	}
	// stage3d owns the floor reflection and the environment map's render target, and clearDemo() disposes them.
	assert.match( room, /stage3d\.own\( reflector\( \{/ )
	assert.match( room, /stage3d\.own\( pmrem\.fromScene\( environment \) \)\.texture/ )
	assert.match( stage3d, /const dispose = resource\.dispose \?\? resource\.destroy \?\? resource\.remove/ )
} )
