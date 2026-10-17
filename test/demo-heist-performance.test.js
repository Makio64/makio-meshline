import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = path => readFile( new URL( `../${path}`, import.meta.url ), 'utf8' )

test( 'Heist bounds post-processing cost and avoids idle picking churn', async () => {
	const [heist, stage3d] = await Promise.all( [
		read( 'demo/src/demos/heist.js' ),
		read( 'demo/src/makio/three/stage3d.js' ),
	] )

	assert.match( heist, /maxPixelRatio: 1\.25/ )
	assert.match( stage3d, /Math\.min\( stage\.devicePixelRatio, this\.maxPixelRatio/ )
	assert.match( heist, /extraThetaMouse = false/ )
	assert.match( heist, /extraPhiMouse = false/ )
	assert.match( heist, /resolutionScale: isMobile \? 0\.35 : 0\.5/ )
	assert.match( heist, /generateMipmaps: false/ )
	// Sub-pixel lasers need multisampling, not resolution, to stay continuous.
	assert.match( heist, /samples: isMobile \? 0 : 4/ )
	assert.match( heist, /scenePass\.setResolutionScale\( isMobile \? 0\.65 : 0\.8 \)/ )
	assert.match( heist, /bloomPass\.setResolutionScale\( isMobile \? 0\.25 : 0\.3 \)/ )
	assert.match( heist, /this\._pickDirty && this\._pickElapsed >= PICK_INTERVAL/ )
	assert.match( heist, /intersectObject\( this\.line, false, this\._raycastHits \)/ )
	assert.match( heist, /this\.reflection\?\.dispose\(\)/ )
	assert.match( heist, /this\.environmentMap\?\.dispose\(\)/ )
} )
